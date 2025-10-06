#pragma once

#include <openssl/x509.h>

// Platform-specific certificate loading functions
extern "C" {

// Load system certificates for the current platform
void us_load_system_certificates_linux(STACK_OF(X509) **system_certs);
void us_load_system_certificates_macos(STACK_OF(X509) **system_certs);
void us_load_system_certificates_windows(STACK_OF(X509) **system_certs);

// Platform-specific cleanup functions
#ifdef __APPLE__
void us_cleanup_security_framework();
#endif

}