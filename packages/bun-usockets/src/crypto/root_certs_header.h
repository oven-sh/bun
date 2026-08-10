#include <openssl/pem.h>
#include <openssl/x509.h>

#ifdef __cplusplus
#define CPPDECL extern "C"

STACK_OF(X509) *us_get_root_extra_cert_instances();
STACK_OF(X509) *us_get_root_system_cert_instances();

#else
#define CPPDECL extern
#endif

/* Contents of a default root store beyond the bundled roots. */
#define US_CA_MODE_BUNDLED 0 /* --no-use-system-ca */
#define US_CA_MODE_DEFAULT 1 /* nothing explicit: OpenSSL's default lookups too */
#define US_CA_MODE_SYSTEM 2  /* --use-system-ca / NODE_USE_SYSTEM_CA=1: the OS store too */
#define US_CA_MODE_COUNT 3

/* Whether the process default includes the OS store (getCACertificates('default') reporting). */
CPPDECL int us_default_use_system_ca();
CPPDECL int us_default_ca_mode();
CPPDECL int us_resolve_ca_mode(int requested);
CPPDECL X509_STORE *us_get_default_ca_store(int mode);
CPPDECL X509_STORE *us_get_shared_default_ca_store(int mode);
CPPDECL int us_is_shared_default_ca_store(X509_STORE *store);
/* The CA mode an SSL_CTX built by us_ssl_ctx_build_raw was created with. */
CPPDECL int us_ssl_ctx_ca_mode(SSL_CTX *ctx);
