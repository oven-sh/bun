// Reads lists of CA certificates and CRLs the way Node.js does with OpenSSL.
#include "./root_certs_header.h"
#include "./internal/internal.h"
#include "./root_certs_platform.h"
#include "wtf/SIMDUTF.h"
#include <openssl/bytestring.h>
#include <openssl/err.h>
#include <openssl/pool.h>
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <algorithm>
#include <string>
#include <utility>

// An entry can withdraw trust, so it must not pass for malformed, or for the end, because memory ran out.
static void us_check_memory() {
  if (ERR_equals(ERR_peek_error(), ERR_LIB_CRYPTO, ERR_R_MALLOC_FAILURE)) Bun__outOfMemory();
}

// Reads what d2i_X509 and d2i_X509_CERT_AUX of OpenSSL accept, and copies it in a form that those of BoringSSL accept.
// https://github.com/nodejs/node/blob/v26.12.1/deps/openssl/openssl/crypto/asn1/tasn_dec.c
namespace us_openssl_syntax {

static constexpr CBS_ASN1_TAG context(CBS_ASN1_TAG number) { return CBS_ASN1_CONTEXT_SPECIFIC | number; }

static bool at_end_of_contents(const CBS *in) {
  return CBS_len(in) >= 2 && CBS_data(in)[0] == 0 && CBS_data(in)[1] == 0;
}

static bool more(const CBS *in) { return CBS_len(in) != 0 && !at_end_of_contents(in); }

// `body` is empty if the length is indefinite.
// https://github.com/nodejs/node/blob/v26.12.1/deps/openssl/openssl/crypto/asn1/asn1_lib.c#L46
static bool element(CBS *in, CBS_ASN1_TAG *tag, CBS *body, bool *indefinite) {
  uint8_t first, byte;
  if (!CBS_get_u8(in, &first)) return false;
  uint32_t number = first & 0x1f;
  if (number == 0x1f) {
    number = 0;
    do {
      if (number > INT_MAX >> 7 || !CBS_get_u8(in, &byte)) return false;
      number = number << 7 | (byte & 0x7f);
    } while (byte & 0x80);
  }
  *tag = (first & 0xe0u) << CBS_ASN1_TAG_SHIFT | std::min(number, CBS_ASN1_TAG_NUMBER_MASK);
  if (!CBS_get_u8(in, &byte)) return false;
  *indefinite = byte == 0x80;
  if (*indefinite && !(*tag & CBS_ASN1_CONSTRUCTED)) return false;
  size_t len = byte & 0x80 ? 0 : byte;
  for (int left = byte & 0x80 ? byte & 0x7f : 0; left != 0; left--) {
    if (len > CBS_len(in) || !CBS_get_u8(in, &byte)) return false;
    len = len << 8 | byte;
  }
  return CBS_get_bytes(in, body, len);
}

// 0 if there is no element.
static CBS_ASN1_TAG peek(const CBS *in) {
  CBS copy = *in, body;
  CBS_ASN1_TAG tag;
  bool indefinite;
  return element(&copy, &tag, &body, &indefinite) ? tag : 0;
}

static bool next_is(const CBS *in, CBS_ASN1_TAG tag) {
  return (peek(in) | CBS_ASN1_CONSTRUCTED) == (tag | CBS_ASN1_CONSTRUCTED);
}

static bool contents(CBS *in, auto read) {
  CBS body;
  CBS_ASN1_TAG tag;
  bool indefinite;
  if (!element(in, &tag, &body, &indefinite)) return false;
  if (indefinite) return read(in) && at_end_of_contents(in) && CBS_skip(in, 2);
  return read(&body) && CBS_len(&body) == 0;
}

static bool constructed(CBS *in, CBS_ASN1_TAG tag, auto read) {
  return peek(in) == (tag | CBS_ASN1_CONSTRUCTED) && contents(in, read);
}

// The tag of a list does not have to say that it is constructed.
static bool list(CBS *in, CBS_ASN1_TAG tag, auto read) {
  return next_is(in, tag) && contents(in, [&](CBS *items) {
    while (more(items)) {
      if (!read(items)) return false;
    }
    return true;
  });
}

static bool collect(CBS *in, std::string &out, int depth = 0) {
  constexpr int ASN1_MAX_STRING_NEST = 5;
  bool in_pieces = peek(in) & CBS_ASN1_CONSTRUCTED;
  return contents(in, [&](CBS *body) -> bool {
    if (!in_pieces) {
      out.append(reinterpret_cast<const char *>(CBS_data(body)), CBS_len(body));
      return CBS_skip(body, CBS_len(body));
    }
    if (depth > ASN1_MAX_STRING_NEST) return false;
    while (more(body)) {
      if (!collect(body, out, depth + 1)) return false;
    }
    return true;
  });
}

static bool value(CBS *in, CBS_ASN1_TAG tag, CBS_ASN1_TAG type, std::string &out) {
  bool whole = !(peek(in) & CBS_ASN1_CONSTRUCTED);
  if (!next_is(in, tag) || !collect(in, out)) return false;
  CBS bytes;
  CBS_init(&bytes, reinterpret_cast<const uint8_t *>(out.data()), out.size());
  switch (type) {
  case CBS_ASN1_BOOLEAN: return whole && out.size() == 1;
  case CBS_ASN1_INTEGER:
  case CBS_ASN1_ENUMERATED: return whole && CBS_is_valid_asn1_integer(&bytes, nullptr);
  case CBS_ASN1_NULL: return whole && out.empty();
  case CBS_ASN1_OBJECT: return whole && CBS_is_valid_asn1_oid(&bytes);
  case CBS_ASN1_BITSTRING:
    if (out.empty() || static_cast<uint8_t>(out[0]) > 7) return false;
    // The unused bits, or their count if there are no bits.
    out.back() &= 0xff << out[0];
    return true;
  case CBS_ASN1_UTCTIME: return out.size() >= strlen("YYMMDDHHMMSSZ");
  case CBS_ASN1_GENERALIZEDTIME: return out.size() >= strlen("YYYYMMDDHHMMSSZ");
  case CBS_ASN1_BMPSTRING: return out.size() % 2 == 0;
  case CBS_ASN1_UNIVERSALSTRING: return out.size() % 4 == 0;
  default: return true;
  }
}

static bool optional(CBS *in, CBS_ASN1_TAG tag, CBS_ASN1_TAG type) {
  std::string out;
  return !next_is(in, tag) || value(in, tag, type, out);
}

static bool skip(CBS *in) {
  size_t open = 0;
  do {
    CBS body;
    CBS_ASN1_TAG tag;
    bool indefinite;
    if (!element(in, &tag, &body, &indefinite)) return false;
    for (open += indefinite; open != 0 && at_end_of_contents(in); open--) CBS_skip(in, 2);
  } while (open != 0);
  return true;
}

static bool add(CBB *out, CBS_ASN1_TAG type, const std::string &bytes) {
  return CBB_add_asn1_element(out, type, reinterpret_cast<const uint8_t *>(bytes.data()), bytes.size());
}

static bool copy_value(CBS *in, CBS_ASN1_TAG type, CBB *out) {
  std::string bytes;
  return value(in, type, type, bytes) && add(out, type, bytes);
}

static bool is_readable(const uint8_t *element, size_t len) {
  if (us_unique_ptr<ASN1_TYPE, ASN1_TYPE_free>{d2i_ASN1_TYPE(nullptr, &element, len)}) return true;
  us_check_memory();
  ERR_clear_error();
  return false;
}

// What BoringSSL does not read as DER either is wrapped, so that it still only equals itself.
static bool copy_any(CBS *in, CBB *out, std::string &bytes) {
  const uint8_t *start = CBS_data(in);
  CBS_ASN1_TAG type = peek(in) & ~CBS_ASN1_CONSTRUCTED;
  bool is_opaque = (type & CBS_ASN1_CLASS_MASK) != CBS_ASN1_UNIVERSAL || peek(in) == CBS_ASN1_SEQUENCE ||
                   peek(in) == CBS_ASN1_SET;
  if (is_opaque ? !skip(in)
                : next_is(in, CBS_ASN1_SEQUENCE) || next_is(in, CBS_ASN1_SET) || !value(in, type, type, bytes)) {
    return false;
  }
  size_t len = CBS_data(in) - start, before = CBB_len(out);
  if (is_readable(start, len)) return CBB_add_bytes(out, start, len);
  if (!is_opaque) {
    if (!add(out, type, bytes)) return false;
    if (is_readable(CBB_data(out) + before, CBB_len(out) - before)) return true;
    CBB_discard(out, CBB_len(out) - before);
  }
  return CBB_add_asn1_octet_string(out, start, len);
}

static bool copy_constructed(CBS *in, CBS_ASN1_TAG tag, CBB *out, auto copy_fields) {
  CBB copy;
  return CBB_add_asn1(out, &copy, tag | CBS_ASN1_CONSTRUCTED) &&
         constructed(in, tag, [&](CBS *fields) { return copy_fields(fields, &copy); }) && CBB_flush(out);
}

static bool copy_list(CBS *in, CBS_ASN1_TAG tag, CBB *out, auto copy_item) {
  CBB copy;
  return CBB_add_asn1(out, &copy, tag | CBS_ASN1_CONSTRUCTED) &&
         list(in, tag, [&](CBS *items) { return copy_item(items, &copy); }) && CBB_flush(out);
}

static bool check_only(CBS *in, CBB *scratch, auto copy) {
  size_t before = CBB_len(scratch);
  if (!copy(in, scratch)) return false;
  CBB_discard(scratch, CBB_len(scratch) - before);
  return true;
}

static bool is_unicode(CBS_ASN1_TAG type, const std::string &text) {
  if (type == CBS_ASN1_UTF8STRING) return simdutf::validate_utf8(text.data(), text.size());
  size_t width = type == CBS_ASN1_BMPSTRING ? 2 : type == CBS_ASN1_UNIVERSALSTRING ? 4 : 1;
  for (size_t at = 0; at < text.size(); at += width) {
    uint32_t c = 0;
    for (size_t i = 0; i < width; i++) c = c << 8 | static_cast<uint8_t>(text[at + i]);
    if (c > 0x10ffff || (c >= 0xd800 && c <= 0xdfff)) return false;
  }
  return true;
}

// https://github.com/nodejs/node/blob/v26.12.1/deps/openssl/openssl/crypto/x509/x_name.c
static bool attribute(CBS *in, CBB *out) {
  return copy_constructed(in, CBS_ASN1_SEQUENCE, out, [](CBS *entry, CBB *out) {
    if (!copy_value(entry, CBS_ASN1_OBJECT, out)) return false;
    // The tags in B_ASN1_PRINTABLE.
    constexpr uint32_t printable = 1 << 3 | 1 << 7 | 1 << 8 | 1 << 9 | 1 << 11 | 1 << 12 | 1 << 13 | 1 << 14 | 1 << 15 |
                                   1 << 16 | 1 << 18 | 1 << 19 | 1 << 20 | 1 << 22 | 1 << 28 | 1 << 29 | 1 << 30;
    CBS_ASN1_TAG type = peek(entry) & ~CBS_ASN1_CONSTRUCTED;
    std::string text;
    return type <= 30 && (printable >> type & 1) && copy_any(entry, out, text) && is_unicode(type, text);
  });
}

static bool name(CBS *in, CBB *out) {
  return copy_list(in, CBS_ASN1_SEQUENCE, out, [](CBS *rdns, CBB *out) {
    size_t before = CBB_len(out);
    if (!copy_list(rdns, CBS_ASN1_SET, out, attribute)) return false;
    // An empty one does not count when names are compared.
    if (CBB_len(out) - before == 2) CBB_discard(out, 2);
    return true;
  });
}

static bool algorithm(CBS *in, CBB *out) {
  return copy_constructed(in, CBS_ASN1_SEQUENCE, out, [](CBS *fields, CBB *out) {
    std::string parameters;
    return copy_value(fields, CBS_ASN1_OBJECT, out) && (!more(fields) || copy_any(fields, out, parameters));
  });
}

static bool time(CBS *in, CBB *out, const char *if_invalid) {
  CBS_ASN1_TAG type = next_is(in, CBS_ASN1_UTCTIME) ? CBS_ASN1_UTCTIME : CBS_ASN1_GENERALIZEDTIME;
  std::string text;
  if (!value(in, type, type, text)) return false;
  CBS bytes;
  CBS_init(&bytes, reinterpret_cast<const uint8_t *>(text.data()), text.size());
  bool is_valid = type == CBS_ASN1_UTCTIME ? CBS_parse_utc_time(&bytes, nullptr, /*allow_timezone_offset=*/1)
                                           : CBS_parse_generalized_time(&bytes, nullptr, /*allow_timezone_offset=*/0);
  return is_valid ? add(out, type, text) : add(out, CBS_ASN1_GENERALIZEDTIME, if_invalid);
}

static bool extension(CBS *in, CBB *out) {
  return copy_constructed(in, CBS_ASN1_SEQUENCE, out, [](CBS *fields, CBB *out) {
    return copy_value(fields, CBS_ASN1_OBJECT, out) &&
           (!next_is(fields, CBS_ASN1_BOOLEAN) || copy_value(fields, CBS_ASN1_BOOLEAN, out)) &&
           copy_value(fields, CBS_ASN1_OCTETSTRING, out);
  });
}

// The copy has the same names, key and extensions, and is out of date if the validity is not one.
// https://github.com/nodejs/node/blob/v26.12.1/deps/openssl/openssl/crypto/x509/x_x509.c
static bool tbs_certificate(CBS *in, CBB *out) {
  return copy_constructed(in, CBS_ASN1_SEQUENCE, out, [](CBS *fields, CBB *out) {
    static constexpr uint8_t v3[] = {0xa0, 3, CBS_ASN1_INTEGER, 1, X509_VERSION_3};
    std::string number;
    auto version = [&](CBS *in) { return value(in, CBS_ASN1_INTEGER, CBS_ASN1_INTEGER, number); };
    auto validity = [](CBS *in, CBB *out) {
      return time(in, out, "99991231235959Z") && time(in, out, "19700101000000Z");
    };
    auto key = [](CBS *in, CBB *out) { return algorithm(in, out) && copy_value(in, CBS_ASN1_BITSTRING, out); };
    auto extensions = [](CBS *in, CBB *out) { return copy_list(in, CBS_ASN1_SEQUENCE, out, extension); };
    if (next_is(fields, context(0)) && !constructed(fields, context(0), version)) return false;
    CBS last = *fields;
    while (more(&last) && !next_is(&last, context(3)) && skip(&last)) {}
    bool is_v1 = number.size() <= 1 && number[0] == X509_VERSION_1 && !more(&last);
    return (is_v1 || CBB_add_bytes(out, v3, sizeof(v3))) && copy_value(fields, CBS_ASN1_INTEGER, out) &&
           algorithm(fields, out) && name(fields, out) && copy_constructed(fields, CBS_ASN1_SEQUENCE, out, validity) &&
           name(fields, out) && copy_constructed(fields, CBS_ASN1_SEQUENCE, out, key) &&
           optional(fields, context(1), CBS_ASN1_BITSTRING) && optional(fields, context(2), CBS_ASN1_BITSTRING) &&
           (!more(fields) || copy_constructed(fields, context(3), out, extensions));
  });
}

static bool verbatim(CBS *in, CBB *out) {
  const uint8_t *start = CBS_data(in);
  return skip(in) && CBB_add_bytes(out, start, CBS_data(in) - start);
}

static bool verbatim_tbs_certificate(CBS *in, CBB *out) {
  const uint8_t *start = CBS_data(in);
  return check_only(in, out, tbs_certificate) && CBB_add_bytes(out, start, CBS_data(in) - start);
}

// What is not signed is copied as DER. A peer can do the same, so it is the same certificate.
static bool copy_signed(CBS *in, CBB *out, auto to_be_signed) {
  return copy_constructed(in, CBS_ASN1_SEQUENCE, out, [&](CBS *fields, CBB *out) {
    return to_be_signed(fields, out) && algorithm(fields, out) && copy_value(fields, CBS_ASN1_BITSTRING, out);
  });
}

static bool certificate(CBS *in, CBB *out) { return copy_signed(in, out, verbatim_tbs_certificate); }

static bool crl(CBS *in, CBB *out) { return copy_signed(in, out, verbatim); }

// A path can end at it but not go through it, and it is not sent to peers.
static bool unsigned_certificate(CBS *in, CBB *out) {
  return copy_constructed(in, CBS_ASN1_SEQUENCE, out, [](CBS *fields, CBB *out) {
    return tbs_certificate(fields, out) && algorithm(fields, out) && skip(fields) &&
           add(out, CBS_ASN1_BITSTRING, std::string(1, '\0'));
  });
}

// Only the trusted and the rejected uses are copied.
// https://github.com/nodejs/node/blob/v26.12.1/deps/openssl/openssl/crypto/x509/x_x509a.c
static bool trust_settings(CBS *in, CBB *out) {
  return copy_constructed(in, CBS_ASN1_SEQUENCE, out, [](CBS *fields, CBB *out) {
    auto uses = [&](CBS_ASN1_TAG tag) {
      return !next_is(fields, tag) ||
             copy_list(fields, tag, out, [](CBS *in, CBB *out) { return copy_value(in, CBS_ASN1_OBJECT, out); });
    };
    return uses(CBS_ASN1_SEQUENCE) && uses(context(0)) && optional(fields, CBS_ASN1_UTF8STRING, CBS_ASN1_UTF8STRING) &&
           optional(fields, CBS_ASN1_OCTETSTRING, CBS_ASN1_OCTETSTRING) &&
           (!more(fields) || list(fields, context(1), [&](CBS *in) { return check_only(in, out, algorithm); }));
  });
}

} // namespace us_openssl_syntax

bool us_pem_block::read(BIO *in) {
  ERR_clear_error();
  if (PEM_read_bio(in, &name, &header, &data, &len)) return true;
  us_check_memory();
  return false;
}

bool us_pem_block::is(const char *label) const { return strcmp(name, label) == 0; }

bool us_pem_block::is_plain_certificate() const { return is(PEM_STRING_X509) || is(PEM_STRING_X509_OLD); }

bool us_pem_block::decrypt() {
  if (PEM_decrypt(header, data, &len, us_no_password_callback, nullptr)) return true;
  us_check_memory();
  return false;
}

// For what BoringSSL has refused. Fails if OpenSSL refuses it too.
static bool us_reencode(us_pem_block *block, bool (*reencode)(CBS *, CBB *), us_ca_trust trust) {
  us_check_memory();
  ERR_clear_error();
  CBS rest;
  CBS_init(&rest, block->data, block->len);
  CBB storage;
  CBB_zero(&storage);
  us_unique_ptr<CBB, CBB_cleanup> copy{&storage};
  uint8_t *data;
  size_t len;
  if (!CBB_init(copy.get(), block->len) || !reencode(&rest, copy.get()) ||
      (trust == us_ca_trust::read && CBS_len(&rest) != 0 && !us_openssl_syntax::trust_settings(&rest, copy.get())) ||
      !CBB_finish(copy.get(), &data, &len)) {
    us_check_memory();
    return false;
  }
  OPENSSL_free(std::exchange(block->data, data));
  block->len = len;
  return true;
}

// `use` returns null or 0 if BoringSSL refuses the certificate.
static auto us_use_ca(us_pem_block *block, us_ca_trust trust, bool *out_malformed, auto use) -> decltype(use()) {
  *out_malformed = false;
  if (auto result = use()) return result;
  *out_malformed = !us_reencode(block, us_openssl_syntax::certificate, trust);
  if (*out_malformed) return {};
  auto result = use();
  CBS rest, uses;
  CBS_init(&rest, block->data, block->len);
  if (!result && CBS_get_asn1(&rest, nullptr, CBS_ASN1_SEQUENCE) && CBS_get_asn1(&rest, &uses, CBS_ASN1_SEQUENCE) &&
      CBS_len(&uses) != 0) {
    // These must not get lost.
    if (us_reencode(block, us_openssl_syntax::unsigned_certificate, trust)) result = use();
    *out_malformed = !result;
  }
  if (!result) us_check_memory();
  return result;
}

X509 *us_pem_block::parse_ca(us_ca_trust trust, CRYPTO_BUFFER **out_der, bool *out_malformed) {
  return us_use_ca(this, trust, out_malformed, [&] {
    const uint8_t *end = data;
    X509 *cert = (trust == us_ca_trust::read ? d2i_X509_AUX : d2i_X509)(nullptr, &end, len);
    if (cert && out_der && !(*out_der = CRYPTO_BUFFER_new(data, end - data, nullptr))) Bun__outOfMemory();
    return cert;
  });
}

size_t us_pem_block::indexable_ca_len(bool *out_malformed) {
  return us_use_ca(this, us_ca_trust::ignored, out_malformed, [&]() -> size_t {
    CBS rest, fields, algorithm, signature;
    CBS_init(&rest, data, len);
    if (!CBS_get_asn1(&rest, &fields, CBS_ASN1_SEQUENCE) || !CBS_get_asn1(&fields, nullptr, CBS_ASN1_SEQUENCE) ||
        !CBS_get_asn1_element(&fields, &algorithm, CBS_ASN1_SEQUENCE) ||
        !CBS_get_asn1(&fields, &signature, CBS_ASN1_BITSTRING) || !CBS_is_valid_asn1_bitstring(&signature) ||
        CBS_len(&fields) != 0) {
      return 0;
    }
    const uint8_t *at = CBS_data(&algorithm);
    us_unique_ptr<X509_ALGOR, X509_ALGOR_free> parsed{d2i_X509_ALGOR(nullptr, &at, CBS_len(&algorithm))};
    size_t cert_len = len - CBS_len(&rest);
    return parsed && X509_LAZY_CERT_SET_can_index(data, cert_len) ? cert_len : 0;
  });
}

X509_CRL *us_pem_block::parse_crl() {
  auto parse = [&] {
    const uint8_t *end = data;
    return d2i_X509_CRL(nullptr, &end, len);
  };
  X509_CRL *crl = parse();
  if (crl == nullptr && us_reencode(this, us_openssl_syntax::crl, us_ca_trust::ignored)) crl = parse();
  if (crl == nullptr) us_check_memory();
  return crl;
}

X509 *us_ca_reader::next(CRYPTO_BUFFER **out_der) {
  for (;;) {
    us_pem_block block;
    if (!block.read(in)) return nullptr;
    if (!block.is_plain_certificate() && !(trust == us_ca_trust::read && block.is(PEM_STRING_X509_TRUSTED))) continue;
    if (!block.decrypt()) return nullptr;
    bool malformed;
    if (X509 *cert = block.parse_ca(trust, out_der, &malformed)) return cert;
    if (malformed) {
      OPENSSL_PUT_ERROR(PEM, ERR_R_ASN1_LIB);
      return nullptr;
    }
    passed_over = true;
  }
}

extern "C" uint8_t *us_pem_read_indexable_ca(BIO *in, size_t *out_len) {
  for (;;) {
    us_pem_block block;
    if (!block.read(in)) return nullptr;
    if (!block.is_plain_certificate()) continue;
    if (!block.decrypt()) return nullptr;
    bool malformed;
    if ((*out_len = block.indexable_ca_len(&malformed)) != 0) return std::exchange(block.data, nullptr);
    if (malformed) return nullptr;
  }
}

static bool us_add_cas(X509_STORE *store, SSL_CTX *names, BIO *in) {
  us_ca_reader reader{in, us_ca_trust::read};
  while (us_unique_ptr<X509, X509_free> cert{reader.next()}) {
    if (!X509_STORE_add_cert(store, cert.get()) || (names && !SSL_CTX_add_client_CA(names, cert.get()))) return false;
  }
  ERR_clear_error();
  return true;
}

static bool us_add_crls(X509_STORE *store, BIO *in) {
  bool added = false;
  for (;;) {
    us_pem_block block;
    if (!block.read(in)) break;
    if (!block.is(PEM_STRING_X509_CRL)) continue;
    if (!block.decrypt()) return false;
    us_unique_ptr<X509_CRL, X509_CRL_free> crl{block.parse_crl()};
    if (crl == nullptr || !X509_STORE_add_crl(store, crl.get())) return false;
    added = true;
  }
  return added && ERR_equals(ERR_peek_last_error(), ERR_LIB_PEM, PEM_R_NO_START_LINE);
}

extern "C" int us_x509_store_add_cas(X509_STORE *store, SSL_CTX *names, const char *pem, size_t len) {
  us_unique_ptr<BIO, BIO_free> in{BIO_new_mem_buf(pem, len)};
  return in && us_add_cas(store, names, in.get());
}

// https://github.com/nodejs/node/blob/v26.12.1/src/crypto/crypto_tls_certificates.cc#L54
extern "C" int us_x509_store_add_crls(X509_STORE *store, const char *pem, size_t len) {
  us_unique_ptr<BIO, BIO_free> in{BIO_new_mem_buf(pem, len)};
  if (in == nullptr || !us_add_crls(store, in.get())) return 0;
  ERR_clear_error();
  return X509_STORE_set_flags(store, X509_V_FLAG_CRL_CHECK | X509_V_FLAG_CRL_CHECK_ALL);
}

void us_x509_store_load_hashed_file(X509_STORE *store, const char *path, int type) {
  FILE *file = fopen(path, "rb");
  if (file == nullptr) {
    if (errno == ENOMEM) Bun__outOfMemory();
    return;
  }
  us_unique_ptr<BIO, BIO_free> in{BIO_new_fp(file, BIO_CLOSE)};
  if (in == nullptr) Bun__outOfMemory();
  type == X509_LU_CRL ? us_add_crls(store, in.get()) : us_add_cas(store, nullptr, in.get());
  us_check_memory();
  ERR_clear_error();
}
