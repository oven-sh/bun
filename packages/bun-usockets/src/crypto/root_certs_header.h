#include <openssl/pem.h>
#include <openssl/x509.h>

#ifdef __cplusplus
#define CPPDECL extern "C"

STACK_OF(X509) *us_get_root_extra_cert_instances();
STACK_OF(X509) *us_get_root_system_cert_instances();
X509_LAZY_CERT_SET *us_get_bundled_root_cert_set();

#else
#define CPPDECL extern
#endif

CPPDECL X509_STORE *us_get_default_ca_store();
CPPDECL X509_STORE *us_get_shared_default_ca_store();
