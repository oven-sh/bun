#include <openssl/pem.h>
#include <openssl/x509.h>

#ifdef __cplusplus
#define CPPDECL extern "C"
#include <mutex>

extern std::mutex us_get_root_extra_cert_instances_mutex;
STACK_OF(X509) *us_get_root_extra_cert_instances();
void us_load_extra_ca_certs(const char *extra_certs);

#else
#define CPPDECL extern
#endif

CPPDECL X509_STORE *us_get_default_ca_store();
