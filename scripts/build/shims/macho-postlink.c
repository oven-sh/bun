/*
 * macho-postlink — post-link fixups for Mach-O executables produced by
 * ld64.lld when cross-linking macOS binaries on a non-darwin host.
 *
 *   macho-postlink <file> [--stack-size=0xNNN] [--entitlements=<plist>]
 *                         [--identifier=<name>]
 *
 * Two jobs, both done in place:
 *
 *  1. `--stack-size`: set `LC_MAIN.stacksize`. Apple's ld64 implements
 *     `-stack_size`; lld's Mach-O port parses it and prints "not yet
 *     implemented" (LLVM 21), leaving the field 0 (= the 8 MB default).
 *     JSC's interpreter recurses deeply enough that bun ships with an
 *     18 MB main-thread stack on every platform — patch the load command
 *     after the fact.
 *
 *  2. Re-generate the ad-hoc code signature, embedding the entitlements
 *     plist. arm64 macOS refuses to exec unsigned binaries, and any header
 *     edit (including #1) invalidates the hash of page 0 in the existing
 *     linker-generated CodeDirectory — so a re-sign is mandatory whenever
 *     the stack size is patched. While re-signing, the entitlements plist
 *     is embedded as both the XML blob (CSSLOT_ENTITLEMENTS) and the
 *     DER blob (CSSLOT_DER_ENTITLEMENTS — required by AMFI for binaries
 *     whose deployment target is macOS 12+). The signature replaces the
 *     one already reserved by `-adhoc_codesign`; the file is grown or
 *     shrunk as needed and __LINKEDIT / LC_CODE_SIGNATURE are updated to
 *     match.
 *
 * Standalone by design: no dependency beyond libc, compiles as C11 on any
 * host (`cc -O2 macho-postlink.c -o macho-postlink`), so it can also be
 * run by hand on a Mac to inspect/repair a binary. All Mach-O and code-
 * signature structures are defined locally rather than pulled from
 * <mach-o/loader.h> so the Linux build doesn't need Apple headers.
 *
 * The signature layout intentionally mirrors what `codesign --sign -`
 * produces: SuperBlob{ CodeDirectory, Requirements(empty), Entitlements,
 * DER Entitlements }, SHA-256 page hashes over [0, dataoff), special
 * slots -1..-7 with the entitlement/requirement blob hashes filled in.
 */

/* ftruncate/fileno are POSIX, hidden under -std=c11 without this. The tool
 * only ever runs on POSIX hosts (a Linux build box or a Mac). */
#define _POSIX_C_SOURCE 200809L

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <unistd.h>

/* ────────────────────────────────────────────────────────────────────────
 * SHA-256 (FIPS 180-4). Self-contained so the tool has no library
 * dependency on either the build host or a Mac.
 * ──────────────────────────────────────────────────────────────────────── */

typedef struct {
  uint32_t state[8];
  uint64_t total_len;
  uint8_t buf[64];
  size_t buf_len;
} sha256_ctx;

static const uint32_t SHA256_K[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
};

static uint32_t rotr32(uint32_t x, unsigned n) {
  return (x >> n) | (x << (32 - n));
}

static void sha256_init(sha256_ctx *c) {
  static const uint32_t iv[8] = {
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  };
  memcpy(c->state, iv, sizeof(iv));
  c->total_len = 0;
  c->buf_len = 0;
}

static void sha256_block(sha256_ctx *c, const uint8_t *p) {
  uint32_t w[64];
  for (int i = 0; i < 16; i++) {
    w[i] = ((uint32_t)p[i * 4] << 24) | ((uint32_t)p[i * 4 + 1] << 16) | ((uint32_t)p[i * 4 + 2] << 8) |
           (uint32_t)p[i * 4 + 3];
  }
  for (int i = 16; i < 64; i++) {
    uint32_t s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >> 3);
    uint32_t s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  uint32_t a = c->state[0], b = c->state[1], cc = c->state[2], d = c->state[3];
  uint32_t e = c->state[4], f = c->state[5], g = c->state[6], h = c->state[7];
  for (int i = 0; i < 64; i++) {
    uint32_t s1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
    uint32_t ch = (e & f) ^ (~e & g);
    uint32_t t1 = h + s1 + ch + SHA256_K[i] + w[i];
    uint32_t s0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
    uint32_t maj = (a & b) ^ (a & cc) ^ (b & cc);
    uint32_t t2 = s0 + maj;
    h = g;
    g = f;
    f = e;
    e = d + t1;
    d = cc;
    cc = b;
    b = a;
    a = t1 + t2;
  }
  c->state[0] += a;
  c->state[1] += b;
  c->state[2] += cc;
  c->state[3] += d;
  c->state[4] += e;
  c->state[5] += f;
  c->state[6] += g;
  c->state[7] += h;
}

static void sha256_update(sha256_ctx *c, const void *data, size_t len) {
  const uint8_t *p = (const uint8_t *)data;
  c->total_len += len;
  if (c->buf_len > 0) {
    size_t take = 64 - c->buf_len;
    if (take > len) take = len;
    memcpy(c->buf + c->buf_len, p, take);
    c->buf_len += take;
    p += take;
    len -= take;
    if (c->buf_len == 64) {
      sha256_block(c, c->buf);
      c->buf_len = 0;
    }
  }
  while (len >= 64) {
    sha256_block(c, p);
    p += 64;
    len -= 64;
  }
  if (len > 0) {
    memcpy(c->buf, p, len);
    c->buf_len = len;
  }
}

static void sha256_final(sha256_ctx *c, uint8_t out[32]) {
  /* Capture the message length before padding mutates total_len. */
  uint64_t bit_len = c->total_len * 8;
  uint8_t pad = 0x80;
  sha256_update(c, &pad, 1);
  uint8_t zero = 0;
  while (c->buf_len != 56) {
    sha256_update(c, &zero, 1);
  }
  uint8_t lenbuf[8];
  for (int i = 0; i < 8; i++) lenbuf[i] = (uint8_t)(bit_len >> (56 - i * 8));
  sha256_update(c, lenbuf, 8);
  for (int i = 0; i < 8; i++) {
    out[i * 4] = (uint8_t)(c->state[i] >> 24);
    out[i * 4 + 1] = (uint8_t)(c->state[i] >> 16);
    out[i * 4 + 2] = (uint8_t)(c->state[i] >> 8);
    out[i * 4 + 3] = (uint8_t)(c->state[i]);
  }
}

static void sha256(const void *data, size_t len, uint8_t out[32]) {
  sha256_ctx c;
  sha256_init(&c);
  sha256_update(&c, data, len);
  sha256_final(&c, out);
}

/* ────────────────────────────────────────────────────────────────────────
 * Mach-O structures (subset of <mach-o/loader.h>, defined locally so this
 * compiles on non-darwin hosts). All header fields are little-endian on
 * the architectures we target (x86_64, arm64).
 * ──────────────────────────────────────────────────────────────────────── */

#define MH_MAGIC_64 0xfeedfacfu
#define CPU_TYPE_ARM64 0x0100000cu
#define CPU_TYPE_X86_64 0x01000007u

#define LC_REQ_DYLD 0x80000000u
#define LC_SEGMENT_64 0x19u
#define LC_CODE_SIGNATURE 0x1du
#define LC_MAIN (0x28u | LC_REQ_DYLD)

typedef struct {
  uint32_t magic;
  uint32_t cputype;
  uint32_t cpusubtype;
  uint32_t filetype;
  uint32_t ncmds;
  uint32_t sizeofcmds;
  uint32_t flags;
  uint32_t reserved;
} mach_header_64;

typedef struct {
  uint32_t cmd;
  uint32_t cmdsize;
} load_command;

typedef struct {
  uint32_t cmd;
  uint32_t cmdsize;
  uint64_t entryoff;
  uint64_t stacksize;
} entry_point_command;

typedef struct {
  uint32_t cmd;
  uint32_t cmdsize;
  char segname[16];
  uint64_t vmaddr;
  uint64_t vmsize;
  uint64_t fileoff;
  uint64_t filesize;
  uint32_t maxprot;
  uint32_t initprot;
  uint32_t nsects;
  uint32_t flags;
} segment_command_64;

typedef struct {
  uint32_t cmd;
  uint32_t cmdsize;
  uint32_t dataoff;
  uint32_t datasize;
} linkedit_data_command;

/* ────────────────────────────────────────────────────────────────────────
 * Code signature structures (subset of <Security/CSCommon.h> /
 * osfmk/kern/cs_blobs.h). All fields are BIG-endian on disk.
 * ──────────────────────────────────────────────────────────────────────── */

#define CSMAGIC_REQUIREMENTS 0xfade0c01u
#define CSMAGIC_CODEDIRECTORY 0xfade0c02u
#define CSMAGIC_EMBEDDED_SIGNATURE 0xfade0cc0u
#define CSMAGIC_EMBEDDED_ENTITLEMENTS 0xfade7171u
#define CSMAGIC_EMBEDDED_DER_ENTITLEMENTS 0xfade7172u

#define CSSLOT_CODEDIRECTORY 0u
#define CSSLOT_REQUIREMENTS 2u
#define CSSLOT_ENTITLEMENTS 5u
#define CSSLOT_DER_ENTITLEMENTS 7u

#define CS_ADHOC 0x00000002u
#define CS_HASHTYPE_SHA256 2u
#define CS_EXECSEG_MAIN_BINARY 0x1u

#define CS_PAGE_SIZE 4096u /* CodeDirectory page granule — always 4 KB, even on 16 KB-page arm64. */
#define CS_HASH_SIZE 32u   /* SHA-256 */

/* CodeDirectory version 0x20400 — earliest version with the execSeg
 * fields the kernel uses to decide whether MAP_JIT is allowed. */
#define CS_CODEDIRECTORY_VERSION 0x20400u

typedef struct {
  uint32_t magic;
  uint32_t length;
  uint32_t count;
} cs_superblob;

typedef struct {
  uint32_t type;
  uint32_t offset;
} cs_blob_index;

typedef struct {
  uint32_t magic;
  uint32_t length;
  uint32_t version;
  uint32_t flags;
  uint32_t hashOffset;
  uint32_t identOffset;
  uint32_t nSpecialSlots;
  uint32_t nCodeSlots;
  uint32_t codeLimit;
  uint8_t hashSize;
  uint8_t hashType;
  uint8_t platform;
  uint8_t pageSize; /* log2 */
  uint32_t spare2;
  uint32_t scatterOffset; /* v0x20100 */
  uint32_t teamOffset;    /* v0x20200 */
  uint32_t spare3;        /* v0x20300 */
  uint64_t codeLimit64;   /* v0x20300 */
  uint64_t execSegBase;   /* v0x20400 */
  uint64_t execSegLimit;  /* v0x20400 */
  uint64_t execSegFlags;  /* v0x20400 */
} cs_code_directory;

/* ────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────── */

static const char *g_file = "<unknown>";

static void die(const char *msg) {
  fprintf(stderr, "macho-postlink: %s: %s\n", g_file, msg);
  exit(1);
}

static void die2(const char *msg, const char *detail) {
  fprintf(stderr, "macho-postlink: %s: %s: %s\n", g_file, msg, detail);
  exit(1);
}

static uint32_t be32(uint32_t v) {
  return ((v & 0xffu) << 24) | ((v & 0xff00u) << 8) | ((v >> 8) & 0xff00u) | (v >> 24);
}

static uint64_t be64(uint64_t v) {
  return ((uint64_t)be32((uint32_t)v) << 32) | be32((uint32_t)(v >> 32));
}

/* Growable byte buffer for assembling the signature superblob. */
typedef struct {
  uint8_t *data;
  size_t len;
  size_t cap;
} buf_t;

static void buf_reserve(buf_t *b, size_t extra) {
  if (b->len + extra <= b->cap) return;
  size_t cap = b->cap ? b->cap : 256;
  while (cap < b->len + extra) cap *= 2;
  uint8_t *p = (uint8_t *)realloc(b->data, cap);
  if (!p) die("out of memory");
  b->data = p;
  b->cap = cap;
}

static void buf_push(buf_t *b, const void *data, size_t len) {
  buf_reserve(b, len);
  memcpy(b->data + b->len, data, len);
  b->len += len;
}

static void buf_push_byte(buf_t *b, uint8_t v) {
  buf_push(b, &v, 1);
}

/* ────────────────────────────────────────────────────────────────────────
 * Entitlements: minimal plist reader + DER encoder
 *
 * Only the subset of plist that bun's entitlements files use is accepted:
 * a single <dict> of <key>NAME</key> followed by <true/> or <false/>.
 * Anything else (strings, arrays, nested dicts) is rejected so a future
 * edit to entitlements.plist can't silently produce a DER blob that
 * doesn't match the XML — AMFI compares the two.
 * ──────────────────────────────────────────────────────────────────────── */

typedef struct {
  char *key;
  int value; /* 0 or 1 */
} entitlement_t;

typedef struct {
  entitlement_t *items;
  size_t count;
} entitlements_t;

static const char *skip_ws(const char *p) {
  while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
  return p;
}

/* Parse `<key>...</key>` / `<true/>` / `<false/>` pairs out of the plist.
 * Returns the number of pairs found. Dies on anything it doesn't understand
 * between a <key> and its value. */
static entitlements_t parse_entitlements(const char *xml) {
  entitlements_t out = {NULL, 0};
  size_t cap = 0;
  const char *p = xml;
  for (;;) {
    const char *k = strstr(p, "<key>");
    if (!k) break;
    k += 5;
    const char *kend = strstr(k, "</key>");
    if (!kend) die("entitlements plist: unterminated <key>");
    const char *v = skip_ws(kend + 6);
    int value;
    if (strncmp(v, "<true/>", 7) == 0) {
      value = 1;
      p = v + 7;
    } else if (strncmp(v, "<false/>", 8) == 0) {
      value = 0;
      p = v + 8;
    } else {
      die("entitlements plist: only boolean values are supported "
          "(update the DER encoder in macho-postlink.c if a non-boolean entitlement is added)");
      return out; /* unreachable */
    }
    if (out.count == cap) {
      cap = cap ? cap * 2 : 8;
      out.items = (entitlement_t *)realloc(out.items, cap * sizeof(entitlement_t));
      if (!out.items) die("out of memory");
    }
    size_t klen = (size_t)(kend - k);
    char *key = (char *)malloc(klen + 1);
    if (!key) die("out of memory");
    memcpy(key, k, klen);
    key[klen] = 0;
    if (strchr(key, '&') || strchr(key, '<')) die("entitlements plist: XML escapes in keys are not supported");
    out.items[out.count].key = key;
    out.items[out.count].value = value;
    out.count++;
  }
  if (out.count == 0) die("entitlements plist: no <key>/<true|false/> pairs found");
  /* DER dictionaries are sorted by key. Insertion sort — the list is tiny. */
  for (size_t i = 1; i < out.count; i++) {
    entitlement_t tmp = out.items[i];
    size_t j = i;
    while (j > 0 && strcmp(out.items[j - 1].key, tmp.key) > 0) {
      out.items[j] = out.items[j - 1];
      j--;
    }
    out.items[j] = tmp;
  }
  return out;
}

/* DER definite-length encoding. */
static void der_push_len(buf_t *b, size_t len) {
  if (len < 0x80) {
    buf_push_byte(b, (uint8_t)len);
  } else if (len <= 0xff) {
    buf_push_byte(b, 0x81);
    buf_push_byte(b, (uint8_t)len);
  } else if (len <= 0xffff) {
    buf_push_byte(b, 0x82);
    buf_push_byte(b, (uint8_t)(len >> 8));
    buf_push_byte(b, (uint8_t)len);
  } else {
    die("entitlements DER: value too large");
  }
}

static void der_push_tlv(buf_t *b, uint8_t tag, const void *data, size_t len) {
  buf_push_byte(b, tag);
  der_push_len(b, len);
  buf_push(b, data, len);
}

/*
 * DER entitlements payload (the bytes after the 8-byte blob header):
 *
 *   APPLICATION [16] constructed (0x70) {
 *     INTEGER 1
 *     CONTEXT [16] constructed (0xB0) {
 *       SEQUENCE { UTF8String key, BOOLEAN value }   (sorted by key)
 *       ...
 *     }
 *   }
 *
 * Matches the encoding `codesign` has emitted since macOS 12 and the one
 * rcodesign/apple-codesign produces.
 */
static buf_t der_encode_entitlements(const entitlements_t *ents) {
  /* Inner dict: concatenated SEQUENCEs. */
  buf_t dict = {0};
  for (size_t i = 0; i < ents->count; i++) {
    buf_t seq = {0};
    der_push_tlv(&seq, 0x0c /* UTF8String */, ents->items[i].key, strlen(ents->items[i].key));
    uint8_t boolval = ents->items[i].value ? 0xff : 0x00;
    der_push_tlv(&seq, 0x01 /* BOOLEAN */, &boolval, 1);
    buf_push_byte(&dict, 0x30 /* SEQUENCE, constructed */);
    der_push_len(&dict, seq.len);
    buf_push(&dict, seq.data, seq.len);
    free(seq.data);
  }

  /* version INTEGER 1 + CONTEXT[16]{dict} */
  buf_t body = {0};
  uint8_t one = 1;
  der_push_tlv(&body, 0x02 /* INTEGER */, &one, 1);
  buf_push_byte(&body, 0xb0 /* CONTEXT [16], constructed */);
  der_push_len(&body, dict.len);
  buf_push(&body, dict.data, dict.len);
  free(dict.data);

  /* APPLICATION[16]{body} */
  buf_t out = {0};
  buf_push_byte(&out, 0x70 /* APPLICATION [16], constructed */);
  der_push_len(&out, body.len);
  buf_push(&out, body.data, body.len);
  free(body.data);
  return out;
}

/* ────────────────────────────────────────────────────────────────────────
 * Signature assembly
 * ──────────────────────────────────────────────────────────────────────── */

/* Append a generic blob (4-byte magic, 4-byte total length, payload),
 * recording its offset within `sb` into *out_off. */
static void push_blob(buf_t *sb, uint32_t magic, const void *payload, size_t payload_len, uint32_t *out_off) {
  *out_off = (uint32_t)sb->len;
  uint32_t hdr[2] = {be32(magic), be32((uint32_t)(payload_len + 8))};
  buf_push(sb, hdr, sizeof(hdr));
  if (payload_len > 0) buf_push(sb, payload, payload_len);
}

/*
 * Build the embedded-signature superblob.
 *
 *   code:        the file contents from offset 0 to code_limit (= dataoff)
 *   identifier:  signing identifier (NUL-terminated in the blob)
 *   ents_xml:    raw plist bytes, or NULL to skip the entitlement blobs
 *   exec_*:      __TEXT segment file extent for the execSeg fields
 */
static buf_t build_signature(const uint8_t *code, uint64_t code_limit, const char *identifier, const char *ents_xml,
                             size_t ents_xml_len, uint64_t exec_seg_base, uint64_t exec_seg_limit) {
  uint32_t n_special = 0;
  uint32_t n_blobs = 1; /* CodeDirectory */

  /* Empty Requirements superblob — what `codesign --sign -` embeds. */
  const uint8_t reqs_payload[4] = {0, 0, 0, 0}; /* count = 0 */
  n_blobs += 1;
  if (n_special < CSSLOT_REQUIREMENTS) n_special = CSSLOT_REQUIREMENTS;

  buf_t der = {0};
  if (ents_xml != NULL) {
    entitlements_t ents = parse_entitlements(ents_xml);
    der = der_encode_entitlements(&ents);
    for (size_t i = 0; i < ents.count; i++) free(ents.items[i].key);
    free(ents.items);
    n_blobs += 2;
    if (n_special < CSSLOT_DER_ENTITLEMENTS) n_special = CSSLOT_DER_ENTITLEMENTS;
  }

  /* CodeDirectory layout: header, identifier, special-slot hashes
   * (stored in *reverse* slot order, ending right at hashOffset), then
   * code-slot hashes. */
  size_t ident_len = strlen(identifier) + 1;
  uint64_t n_code_slots = (code_limit + CS_PAGE_SIZE - 1) / CS_PAGE_SIZE;
  size_t cd_header = sizeof(cs_code_directory);
  size_t ident_off = cd_header;
  size_t hash_off = ident_off + ident_len + (size_t)n_special * CS_HASH_SIZE;
  size_t cd_len = hash_off + (size_t)n_code_slots * CS_HASH_SIZE;

  uint8_t *cd = (uint8_t *)calloc(1, cd_len);
  if (!cd) die("out of memory");
  cs_code_directory *cdh = (cs_code_directory *)cd;
  cdh->magic = be32(CSMAGIC_CODEDIRECTORY);
  cdh->length = be32((uint32_t)cd_len);
  cdh->version = be32(CS_CODEDIRECTORY_VERSION);
  cdh->flags = be32(CS_ADHOC);
  cdh->hashOffset = be32((uint32_t)hash_off);
  cdh->identOffset = be32((uint32_t)ident_off);
  cdh->nSpecialSlots = be32(n_special);
  cdh->nCodeSlots = be32((uint32_t)n_code_slots);
  /* codeLimit is 32-bit; a >4 GB executable would need codeLimit64. The
   * linker would have failed long before that, but check anyway. */
  if (code_limit > 0xffffffffull) die("binary too large for a 32-bit codeLimit");
  cdh->codeLimit = be32((uint32_t)code_limit);
  cdh->hashSize = CS_HASH_SIZE;
  cdh->hashType = CS_HASHTYPE_SHA256;
  cdh->platform = 0;
  cdh->pageSize = 12; /* log2(4096) */
  cdh->execSegBase = be64(exec_seg_base);
  cdh->execSegLimit = be64(exec_seg_limit);
  cdh->execSegFlags = be64(CS_EXECSEG_MAIN_BINARY);
  memcpy(cd + ident_off, identifier, ident_len);

  /* Code-slot hashes: SHA-256 of each 4 KB page of [0, code_limit). The
   * final partial page is hashed over only the bytes present (matching
   * the kernel's validation in cs_validate_page). */
  for (uint64_t i = 0; i < n_code_slots; i++) {
    uint64_t off = i * CS_PAGE_SIZE;
    uint64_t len = code_limit - off;
    if (len > CS_PAGE_SIZE) len = CS_PAGE_SIZE;
    sha256(code + off, (size_t)len, cd + hash_off + (size_t)i * CS_HASH_SIZE);
  }

  /* Assemble the superblob: header + index entries + blobs. */
  size_t index_bytes = sizeof(cs_superblob) + (size_t)n_blobs * sizeof(cs_blob_index);
  buf_t sb = {0};
  buf_reserve(&sb, index_bytes);
  memset(sb.data, 0, index_bytes);
  sb.len = index_bytes;

  uint32_t cd_off, reqs_off, ents_off = 0, der_off = 0;
  /* The CodeDirectory already begins with its own magic+length header, so
   * it's appended verbatim rather than via push_blob(). */
  cd_off = (uint32_t)sb.len;
  buf_push(&sb, cd, cd_len);
  free(cd);

  push_blob(&sb, CSMAGIC_REQUIREMENTS, reqs_payload, sizeof(reqs_payload), &reqs_off);
  if (ents_xml != NULL) {
    push_blob(&sb, CSMAGIC_EMBEDDED_ENTITLEMENTS, ents_xml, ents_xml_len, &ents_off);
    push_blob(&sb, CSMAGIC_EMBEDDED_DER_ENTITLEMENTS, der.data, der.len, &der_off);
  }
  free(der.data);

  /* Special-slot hashes are SHA-256 of each blob (header included),
   * stored at hashOffset - slot*hashSize. Slots without a blob stay
   * all-zero (calloc above). Blob offsets within a superblob are not
   * 4-byte aligned (codesign doesn't align them either), so the lengths
   * are recomputed from the inputs rather than read back from the blob
   * headers. */
  uint8_t *special = sb.data + cd_off + hash_off;
  sha256(sb.data + reqs_off, sizeof(reqs_payload) + 8, special - (size_t)CSSLOT_REQUIREMENTS * CS_HASH_SIZE);
  if (ents_xml != NULL) {
    sha256(sb.data + ents_off, ents_xml_len + 8, special - (size_t)CSSLOT_ENTITLEMENTS * CS_HASH_SIZE);
    sha256(sb.data + der_off, der.len + 8, special - (size_t)CSSLOT_DER_ENTITLEMENTS * CS_HASH_SIZE);
  }

  /* Fill in the superblob header + index now that offsets are known. */
  cs_superblob *hdr = (cs_superblob *)sb.data;
  hdr->magic = be32(CSMAGIC_EMBEDDED_SIGNATURE);
  hdr->length = be32((uint32_t)sb.len);
  hdr->count = be32(n_blobs);
  cs_blob_index *idx = (cs_blob_index *)(sb.data + sizeof(cs_superblob));
  uint32_t slot = 0;
  idx[slot].type = be32(CSSLOT_CODEDIRECTORY);
  idx[slot].offset = be32(cd_off);
  slot++;
  idx[slot].type = be32(CSSLOT_REQUIREMENTS);
  idx[slot].offset = be32(reqs_off);
  slot++;
  if (ents_xml != NULL) {
    idx[slot].type = be32(CSSLOT_ENTITLEMENTS);
    idx[slot].offset = be32(ents_off);
    slot++;
    idx[slot].type = be32(CSSLOT_DER_ENTITLEMENTS);
    idx[slot].offset = be32(der_off);
    slot++;
  }
  return sb;
}

/* ────────────────────────────────────────────────────────────────────────
 * main
 * ──────────────────────────────────────────────────────────────────────── */

static char *read_file(const char *path, size_t *out_len) {
  FILE *f = fopen(path, "rb");
  if (!f) die2("cannot open", path);
  if (fseek(f, 0, SEEK_END) != 0) die2("cannot seek", path);
  long len = ftell(f);
  if (len < 0) die2("cannot tell", path);
  if (fseek(f, 0, SEEK_SET) != 0) die2("cannot seek", path);
  char *data = (char *)malloc((size_t)len + 1);
  if (!data) die("out of memory");
  if (len > 0 && fread(data, 1, (size_t)len, f) != (size_t)len) die2("cannot read", path);
  data[len] = 0;
  fclose(f);
  *out_len = (size_t)len;
  return data;
}

static void usage(void) {
  fprintf(stderr,
          "usage: macho-postlink <file> [--stack-size=0xNNN] [--entitlements=<plist>] [--identifier=<name>]\n"
          "\n"
          "Patches LC_MAIN.stacksize and regenerates the ad-hoc code signature\n"
          "(embedding the entitlements plist) of a Mach-O executable, in place.\n");
  exit(2);
}

int main(int argc, char **argv) {
  const char *file = NULL;
  const char *entitlements_path = NULL;
  const char *identifier = NULL;
  uint64_t stack_size = 0;
  int have_stack_size = 0;

  for (int i = 1; i < argc; i++) {
    const char *a = argv[i];
    if (strncmp(a, "--stack-size=", 13) == 0) {
      char *end = NULL;
      stack_size = strtoull(a + 13, &end, 0);
      if (end == NULL || *end != 0 || stack_size == 0) {
        fprintf(stderr, "macho-postlink: invalid --stack-size value: %s\n", a + 13);
        return 2;
      }
      have_stack_size = 1;
    } else if (strncmp(a, "--entitlements=", 15) == 0) {
      entitlements_path = a + 15;
    } else if (strncmp(a, "--identifier=", 13) == 0) {
      identifier = a + 13;
    } else if (strcmp(a, "--help") == 0 || strcmp(a, "-h") == 0) {
      usage();
    } else if (a[0] == '-') {
      fprintf(stderr, "macho-postlink: unknown option: %s\n", a);
      usage();
    } else if (file == NULL) {
      file = a;
    } else {
      usage();
    }
  }
  if (file == NULL) usage();
  g_file = file;

  size_t size = 0;
  uint8_t *data = (uint8_t *)read_file(file, &size);
  if (size < sizeof(mach_header_64)) die("not a Mach-O file (too small)");

  mach_header_64 *mh = (mach_header_64 *)data;
  if (mh->magic != MH_MAGIC_64) {
    /* A FAT/universal binary or a 32-bit slice would land here. The build
     * only ever links thin 64-bit executables. */
    die("not a thin 64-bit little-endian Mach-O (bad magic)");
  }
  if ((uint64_t)sizeof(mach_header_64) + mh->sizeofcmds > size) die("load commands extend past end of file");

  /* Walk the load commands. */
  entry_point_command *lc_main = NULL;
  linkedit_data_command *lc_codesig = NULL;
  segment_command_64 *seg_linkedit = NULL;
  segment_command_64 *seg_text = NULL;

  uint8_t *p = data + sizeof(mach_header_64);
  uint8_t *cmds_end = p + mh->sizeofcmds;
  for (uint32_t i = 0; i < mh->ncmds; i++) {
    if (p + sizeof(load_command) > cmds_end) die("truncated load command");
    load_command *lc = (load_command *)p;
    if (lc->cmdsize < sizeof(load_command) || p + lc->cmdsize > cmds_end) die("bad load command size");
    if (lc->cmd == LC_MAIN && lc->cmdsize >= sizeof(entry_point_command)) {
      lc_main = (entry_point_command *)p;
    } else if (lc->cmd == LC_CODE_SIGNATURE && lc->cmdsize >= sizeof(linkedit_data_command)) {
      lc_codesig = (linkedit_data_command *)p;
    } else if (lc->cmd == LC_SEGMENT_64 && lc->cmdsize >= sizeof(segment_command_64)) {
      segment_command_64 *seg = (segment_command_64 *)p;
      if (strncmp(seg->segname, "__LINKEDIT", 16) == 0) seg_linkedit = seg;
      if (strncmp(seg->segname, "__TEXT", 16) == 0) seg_text = seg;
    }
    p += lc->cmdsize;
  }

  /* 1. Stack size. */
  if (have_stack_size) {
    if (lc_main == NULL) die("no LC_MAIN load command (is this an executable?)");
    lc_main->stacksize = stack_size;
  }

  /* 2. Re-sign. Always done when a signature exists — even a stack-size-only
   * run invalidates the page-0 hash of the old signature. */
  if (lc_codesig != NULL) {
    if (seg_linkedit == NULL) die("LC_CODE_SIGNATURE present but no __LINKEDIT segment");
    if (seg_text == NULL) die("no __TEXT segment");
    uint64_t dataoff = lc_codesig->dataoff;
    if (dataoff > size || (uint64_t)lc_codesig->datasize > size - dataoff)
      die("LC_CODE_SIGNATURE points past end of file");
    if (dataoff + lc_codesig->datasize != size)
      die("code signature is not the last thing in the file — refusing to re-sign");
    if ((dataoff & 0xf) != 0) die("code signature offset is not 16-byte aligned");

    char *ents_xml = NULL;
    size_t ents_xml_len = 0;
    if (entitlements_path != NULL) ents_xml = read_file(entitlements_path, &ents_xml_len);

    /* Default identifier: the basename of the file, like codesign. */
    char ident_buf[256];
    if (identifier == NULL) {
      const char *base = strrchr(file, '/');
      base = base ? base + 1 : file;
      snprintf(ident_buf, sizeof(ident_buf), "%s", base);
      identifier = ident_buf;
    }

    /* The header edits below (LC_CODE_SIGNATURE.datasize, __LINKEDIT sizes)
     * land in page 0, which is hashed into the CodeDirectory — so the new
     * sizes must be computed and written *before* hashing. The signature
     * size depends only on its inputs, not on the header contents, so do a
     * dry-run layout first to learn the size, patch the header, then build
     * the real thing. */
    buf_t probe = build_signature(data, dataoff, identifier, ents_xml, ents_xml_len, seg_text->fileoff,
                                  seg_text->filesize);
    uint32_t new_datasize = (uint32_t)probe.len;
    free(probe.data);

    lc_codesig->datasize = new_datasize;
    uint64_t new_filesize = dataoff + new_datasize - seg_linkedit->fileoff;
    seg_linkedit->filesize = new_filesize;
    /* vmsize: page-aligned to the *VM* page size (16 KB on arm64, 4 KB on
     * x86_64) — distinct from the 4 KB CodeDirectory page granule. */
    uint64_t vm_page = (mh->cputype == CPU_TYPE_ARM64) ? 0x4000u : 0x1000u;
    seg_linkedit->vmsize = (new_filesize + vm_page - 1) & ~(vm_page - 1);

    buf_t sig = build_signature(data, dataoff, identifier, ents_xml, ents_xml_len, seg_text->fileoff,
                                seg_text->filesize);
    if (sig.len != new_datasize) die("internal error: signature size changed between layout and build");

    /* Rewrite the file: [0, dataoff) unchanged (but with the patched
     * header), then the new signature. */
    FILE *f = fopen(file, "r+b");
    if (!f) die("cannot reopen for writing");
    if (fwrite(data, 1, (size_t)dataoff, f) != dataoff) die("write failed");
    if (fwrite(sig.data, 1, sig.len, f) != sig.len) die("write failed");
    fflush(f);
    /* Shrink the file if the new signature is smaller than the old one
     * (e.g. the linker reserved more space than the final blob needs). */
    if (ftruncate(fileno(f), (off_t)(dataoff + sig.len)) != 0) die("ftruncate failed");
    if (fclose(f) != 0) die("close failed");
    free(sig.data);
    free(ents_xml);
  } else if (have_stack_size) {
    if (entitlements_path != NULL)
      die("no LC_CODE_SIGNATURE to embed entitlements into — link with -Wl,-adhoc_codesign");
    /* No signature to maintain — just write the patched header back. */
    FILE *f = fopen(file, "r+b");
    if (!f) die("cannot reopen for writing");
    if (fwrite(data, 1, sizeof(mach_header_64) + mh->sizeofcmds, f) !=
        sizeof(mach_header_64) + mh->sizeofcmds)
      die("write failed");
    if (fclose(f) != 0) die("close failed");
  } else if (entitlements_path != NULL) {
    die("no LC_CODE_SIGNATURE to embed entitlements into — link with -Wl,-adhoc_codesign");
  }

  free(data);
  return 0;
}
