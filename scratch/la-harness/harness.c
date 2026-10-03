// Standalone differential harness for the non-blocking libarchive read path.
//   harness <file.tgz> ref                      reference: whole input in one read
//   harness <file.tgz> split <from> <to> [mode] every single split offset in [from,to)
//   harness <file.tgz> dribble <k> [mode]       k bytes per read, a retry between each
//   harness <file.tgz> one <offset> [mode]      one split, print the log
//   harness <file.tgz> bench <n>                n reference runs, no log compare
// mode 0 (strict): after ARCHIVE_RETRY the callback stays dry until the driver yields.
// mode 1 (eager):  the next callback call after one ARCHIVE_RETRY has data.
// env LA_OPTS: extra archive_read_set_options string (e.g. "mac-ext").
// env LA_STEP: stride for `split`.  env LA_SHOW: print reference and first differing log.
#include <archive.h>
#include <archive_entry.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Deterministic cost counters (bench): edges executed in libarchive when it is
// built with -fsanitize-coverage=trace-pc-guard, and allocations.
static unsigned long long cov_edges, n_malloc, malloc_bytes;
void __sanitizer_cov_trace_pc_guard_init(uint32_t *start, uint32_t *stop) {
  for (uint32_t *x = start; x < stop; x++) *x = 1;
}
void __sanitizer_cov_trace_pc_guard(uint32_t *guard) { (void)guard; cov_edges++; }
static void malloc_hook(const volatile void *ptr, size_t size) { (void)ptr; n_malloc++; malloc_bytes += size; }
static void free_hook(const volatile void *ptr) { (void)ptr; }
int __sanitizer_install_malloc_and_free_hooks(void (*)(const volatile void *, size_t), void (*)(const volatile void *));

struct src {
  const unsigned char *buf;
  size_t len, pos, k, limit;
  int holds, mode, dry, nonblocking;
  long retries, yields;
};

static void advance(struct src *s) {
  if (s->limit >= s->len) return;
  if (s->k) {
    s->limit += s->k;
    if (s->limit > s->len) s->limit = s->len;
  } else s->limit = s->len;
}

static la_ssize_t read_cb(struct archive *a, void *ctx, const void **out) {
  (void)a;
  struct src *s = ctx;
  if (s->pos < s->limit && !s->dry) {
    *out = s->buf + s->pos;
    la_ssize_t n = (la_ssize_t)(s->limit - s->pos);
    s->pos = s->limit;
    s->holds = 1;
    return n;
  }
  s->holds = 0;
  if (s->pos >= s->len) { *out = s->buf; return 0; }
  s->retries++;
  if (s->mode == 1) advance(s);
  else s->dry = 1;
  return ARCHIVE_RETRY;
}

static void yield(struct src *s) {
  s->yields++;
  if (s->mode == 0) { s->dry = 0; advance(s); }
}

struct log { char *p; size_t len, cap; int off; };
static void lg(struct log *l, const char *fmt, ...) __attribute__((format(printf, 2, 3)));
static void lg(struct log *l, const char *fmt, ...) {
  va_list ap;
  if (l->off) return;
  for (;;) {
    va_start(ap, fmt);
    int n = l->cap ? vsnprintf(l->p + l->len, l->cap - l->len, fmt, ap) : -1;
    va_end(ap);
    if (n >= 0 && (size_t)n < l->cap - l->len) { l->len += (size_t)n; return; }
    l->cap = l->cap ? l->cap * 2 : 4096;
    l->p = realloc(l->p, l->cap);
  }
}

static uint64_t fnv(const unsigned char *p, size_t n, uint64_t h) {
  while (n--) { h ^= *p++; h *= 1099511628211ull; }
  return h;
}

#define IMAGE_MAX (8u << 20)
static const char *es(struct archive *a) {
  const char *e = archive_error_string(a);
  return e ? e : "(null)";
}

// Mirrors TarballStream::step. 0 = read to EOF, 1 = libarchive failure, 2 = hang.
static int run(struct src *s, struct log *l) {
  struct archive *a = archive_read_new();
  archive_read_support_filter_gzip(a);
  if (archive_read_append_filter(a, ARCHIVE_FILTER_GZIP) != 0) { lg(l, "append_filter failed\n"); archive_read_free(a); return 1; }
  archive_read_support_format_tar(a);
  archive_read_set_options(a, "read_concatenated_archives");
  // What TarballStream sets for a source that can run dry. The reference run
  // (one read, like the buffered extractor) leaves it off.
  if (s->nonblocking && archive_read_set_options(a, "nonblocking") != ARCHIVE_OK && getenv("LA_NB_REQUIRED"))
    lg(l, "set_options(nonblocking) failed: %s\n", es(a));
  const char *opts = getenv("LA_OPTS");
  if (opts && *opts) {
    int r = archive_read_set_options(a, opts);
    if (r != ARCHIVE_OK) lg(l, "set_options(%s) = %d %s\n", opts, r, es(a));
  }
  if (archive_read_set_format(a, ARCHIVE_FORMAT_TAR) != 0) { lg(l, "set_format failed\n"); archive_read_free(a); return 1; }
  int orc = archive_read_open(a, s, NULL, read_cb, NULL);
  if (orc != ARCHIVE_OK && orc != ARCHIVE_WARN && orc != ARCHIVE_RETRY) {
    lg(l, "open = %d: %s\n", orc, es(a));
    archive_read_free(a);
    return 1;
  }
  int rc = 0, want_data = 0;
  unsigned char *image = NULL;
  size_t image_cap = 0;
  int64_t written_end = 0, nbytes = 0;
  long spins = 0;
  for (;;) {
    if (++spins > 50000000) { lg(l, "HANG\n"); rc = 2; break; }
    if (!want_data) {
      struct archive_entry *e = NULL;
      int r = archive_read_next_header(a, &e);
      if (r == ARCHIVE_RETRY) {
        if (s->holds) continue;
        yield(s);
        continue;
      }
      if (r == ARCHIVE_EOF) { lg(l, "EOF\n"); break; }
      if (r != ARCHIVE_OK && r != ARCHIVE_WARN) { lg(l, "next_header = %d: %s\n", r, es(a)); rc = 1; break; }
      if (!l->off) {
        const char *path = archive_entry_pathname(e), *sym = archive_entry_symlink(e), *hard = archive_entry_hardlink(e);
        size_t mac = 0;
        const void *macp = archive_entry_mac_metadata(e, &mac);
        lg(l, "H r=%d path=%s size=%lld type=%o perm=%o mtime=%lld.%ld uid=%lld gid=%lld ino=%lld dev=%lld sym=%s hard=%s uname=%s gname=%s mac=%zu:%016llx xattrs=%d",
           r, path ? path : "(null)", (long long)archive_entry_size(e), (unsigned)archive_entry_filetype(e),
           (unsigned)archive_entry_perm(e), (long long)archive_entry_mtime(e), archive_entry_mtime_nsec(e),
           (long long)archive_entry_uid(e), (long long)archive_entry_gid(e), (long long)archive_entry_ino64(e),
           (long long)archive_entry_dev(e), sym ? sym : "-", hard ? hard : "-",
           archive_entry_uname(e) ? archive_entry_uname(e) : "-", archive_entry_gname(e) ? archive_entry_gname(e) : "-",
           mac, (unsigned long long)(mac ? fnv(macp, mac, 7) : 0), archive_entry_xattr_count(e));
        archive_entry_xattr_reset(e);
        const char *xn;
        const void *xv;
        size_t xl;
        while (archive_entry_xattr_next(e, &xn, &xv, &xl) == ARCHIVE_OK) lg(l, " x:%s=%zu:%016llx", xn, xl, (unsigned long long)fnv(xv, xl, 7));
        if (r == ARCHIVE_WARN) lg(l, " warn=%s", es(a));
        int ns = archive_entry_sparse_reset(e);
        lg(l, " fmt=%s sparse=%d[", archive_format_name(a), ns);
        la_int64_t so, sl;
        uint64_t sh = 7;
        int shown = 0;
        while (archive_entry_sparse_next(e, &so, &sl) == ARCHIVE_OK) {
          if (shown++ < 8) lg(l, "%lld+%lld,", (long long)so, (long long)sl);
          sh = fnv((const unsigned char *)&so, sizeof so, sh);
          sh = fnv((const unsigned char *)&sl, sizeof sl, sh);
        }
        lg(l, "]%016llx\n", (unsigned long long)sh);
      }
      int64_t sz = archive_entry_size(e);
      size_t want = !l->off && sz > 0 && (uint64_t)sz <= IMAGE_MAX ? (size_t)sz : 0;
      free(image);
      image = want ? calloc(1, want) : NULL;
      image_cap = want;
      written_end = 0;
      nbytes = 0;
      want_data = 1;
    } else {
      const void *buf = NULL;
      size_t size = 0;
      la_int64_t off = 0;
      int r = archive_read_data_block(a, &buf, &size, &off);
      if (r == ARCHIVE_EOF) {
        lg(l, "E eof_off=%lld end=%lld nbytes=%lld image=%016llx\n", (long long)off, (long long)written_end,
           (long long)nbytes, (unsigned long long)fnv(image, image_cap, 1469598103934665603ull));
        want_data = 0;
        continue;
      }
      if (r == ARCHIVE_RETRY && !s->holds) { yield(s); continue; }
      if (r == ARCHIVE_OK) {
        if (size) {
          if ((uint64_t)off + size <= image_cap) memcpy(image + off, buf, size);
          else if (!l->off && image_cap) lg(l, "D out-of-image off=%lld size=%zu\n", (long long)off, size);
          if ((int64_t)(off + size) > written_end) written_end = off + size;
          nbytes += size;
        }
        continue;
      }
      if (r == ARCHIVE_WARN) { lg(l, "D warn %s\n", es(a)); continue; }
      lg(l, "data_block = %d: %s\n", r, es(a));
      rc = 1;
      break;
    }
  }
  free(image);
  archive_read_free(a);
  return rc;
}

// Same entries and return code; only the text of the final failure line differs.
static int loose_same(const char *a, int arc, const char *b, int brc) {
  if (arc != brc) return 0;
  if (!strcmp(a, b)) return 1;
  if (arc != 1) return 0;
  size_t na = strlen(a), nb = strlen(b);
  size_t ia = na ? na - 1 : 0, ib = nb ? nb - 1 : 0;
  while (ia > 0 && a[ia - 1] != '\n') ia--;
  while (ib > 0 && b[ib - 1] != '\n') ib--;
  if (ia != ib || strncmp(a, b, ia)) return 0;
  const char *ca = strchr(a + ia, ':'), *cb = strchr(b + ib, ':');
  if (!ca || !cb) return 0;
  return (ca - (a + ia)) == (cb - (b + ib)) && !strncmp(a + ia, b + ib, (size_t)(ca - (a + ia)));
}

static void init_src(struct src *s, const unsigned char *buf, size_t len, size_t cut1, size_t k, int mode) {
  memset(s, 0, sizeof(*s));
  s->buf = buf;
  s->len = len;
  s->k = k;
  s->mode = mode;
  s->limit = cut1 ? cut1 : (k ? (k < len ? k : len) : len);
  // Split and dribble runs are a non-blocking client. LA_NB=1 forces the
  // option on for the single-read runs too, LA_NB=0 forces it off everywhere.
  const char *nb = getenv("LA_NB");
  s->nonblocking = nb ? atoi(nb) : (cut1 || k);
}

int main(int argc, char **argv) {
  if (argc < 3) { fprintf(stderr, "usage\n"); return 2; }
  FILE *f = fopen(argv[1], "rb");
  if (!f) { perror(argv[1]); return 2; }
  fseek(f, 0, SEEK_END);
  size_t len = (size_t)ftell(f);
  fseek(f, 0, SEEK_SET);
  unsigned char *buf = malloc(len ? len : 1);
  if (fread(buf, 1, len, f) != len) { perror("read"); return 2; }
  fclose(f);

  struct src s;
  const char *cmd = argv[2];
  if (!strcmp(cmd, "bench")) {
    long n = strtol(argv[3], NULL, 10), ok = 0;
    struct log l = {0};
    l.off = 1;
    __sanitizer_install_malloc_and_free_hooks(malloc_hook, free_hook);
    cov_edges = n_malloc = malloc_bytes = 0;
    for (long i = 0; i < n; i++) {
      init_src(&s, buf, len, 0, 0, 0);
      ok += run(&s, &l) == 0;
    }
    printf("bench runs=%ld ok=%ld edges_per_run=%llu mallocs_per_run=%llu malloc_bytes_per_run=%llu\n", n, ok,
           cov_edges / (unsigned long long)n, n_malloc / (unsigned long long)n, malloc_bytes / (unsigned long long)n);
    free(buf);
    return 0;
  }
  struct log ref = {0};
  init_src(&s, buf, len, 0, 0, 0);
  int ref_rc = run(&s, &ref);
  const char *refp = ref.p ? ref.p : "";
  int ret = 0;
  if (!strcmp(cmd, "ref")) {
    fputs(refp, stdout);
    printf("rc=%d\n", ref_rc);
  } else if (!strcmp(cmd, "one")) {
    size_t cut = strtoull(argv[3], NULL, 10);
    int mode = argc > 4 ? atoi(argv[4]) : 0;
    struct log l = {0};
    init_src(&s, buf, len, cut, 0, mode);
    int rc = run(&s, &l);
    fputs(l.p ? l.p : "", stdout);
    printf("rc=%d retries=%ld yields=%ld same=%d\n", rc, s.retries, s.yields, rc == ref_rc && !strcmp(l.p ? l.p : "", refp));
    free(l.p);
  } else {
    long bad = 0, total = 0, first_bad = -1, last_bad = -1, msg_only = 0, max_retries = 0;
    char *first_log = NULL;
    int is_split = !strcmp(cmd, "split");
    size_t from = 1, to = 2, step = 1, k = 0;
    int mode;
    if (is_split) {
      from = strtoull(argv[3], NULL, 10);
      to = strtoull(argv[4], NULL, 10);
      const char *st = getenv("LA_STEP");
      if (st) step = strtoull(st, NULL, 10);
      mode = argc > 5 ? atoi(argv[5]) : 0;
      if (to == 0 || to > len) to = len;
      if (from == 0) from = 1;
    } else if (!strcmp(cmd, "dribble")) {
      k = strtoull(argv[3], NULL, 10);
      mode = argc > 4 ? atoi(argv[4]) : 0;
    } else {
      fprintf(stderr, "unknown command\n");
      return 2;
    }
    for (size_t cut = from; cut < to; cut += step) {
      struct log l = {0};
      init_src(&s, buf, len, is_split ? cut : 0, k, mode);
      int rc = run(&s, &l);
      const char *lp = l.p ? l.p : "";
      total++;
      if (s.retries > max_retries) max_retries = s.retries;
      if (rc != ref_rc || strcmp(lp, refp)) {
        if (loose_same(lp, rc, refp, ref_rc)) msg_only++;
        else {
          bad++;
          if (first_bad < 0) { first_bad = (long)(is_split ? cut : k); first_log = l.p; l.p = NULL; }
          last_bad = (long)(is_split ? cut : k);
        }
      }
      free(l.p);
    }
    printf("%s %s: runs=%ld bad=%ld msg_only=%ld", argv[1], cmd, total, bad, msg_only);
    if (bad) printf(" first_bad=%ld last_bad=%ld", first_bad, last_bad);
    printf(" ref_rc=%d max_retries=%ld\n", ref_rc, max_retries);
    if (bad && getenv("LA_SHOW")) printf("--- ref ---\n%s--- first bad ---\n%s", refp, first_log ? first_log : "");
    free(first_log);
    if (bad) ret = 1;
  }
  free(ref.p);
  free(buf);
  fflush(stdout);
  return ret;
}
