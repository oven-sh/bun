#include <openssl/pem.h>
#include <openssl/x509.h>

#ifdef __cplusplus
#define CPPDECL extern "C"

STACK_OF(X509) *us_get_root_extra_cert_instances();
X509_LAZY_CERT_SET *us_get_bundled_root_cert_set();

// The OS trust store. Platforms that hand us DER (Linux and other Unix) index it lazily; those whose trust evaluation
// needs the parsed certificate (macOS) or that are not yet converted (Windows) hand back parsed X509s. Either may be
// null/empty.
struct us_system_certs_t {
  X509_LAZY_CERT_SET *lazy = nullptr;
  STACK_OF(X509) *parsed = nullptr;
};
const us_system_certs_t &us_get_root_system_certs();

#else
#define CPPDECL extern
#endif

CPPDECL int us_default_use_system_ca();
CPPDECL int us_resolve_use_system_ca(int requested);
CPPDECL X509_STORE *us_get_default_ca_store(int use_system_ca);
CPPDECL X509_STORE *us_get_shared_default_ca_store(int use_system_ca);
CPPDECL int us_is_shared_default_ca_store(X509_STORE *store);
/* The resolved system-CA decision an SSL_CTX built by us_ssl_ctx_build_raw was created with. */
CPPDECL int us_ssl_ctx_use_system_ca(SSL_CTX *ctx);
