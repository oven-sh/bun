#pragma once

#include <openssl/x509.h>

// Platform-specific certificate loading functions
extern "C" {

// Load system certificates for the current platform
X509_LAZY_CERT_SET *us_load_system_certificates_posix();
void us_load_system_certificates_macos(STACK_OF(X509) **system_certs);
void us_load_system_certificates_windows(STACK_OF(X509) **system_certs);

// Passphrase callback that never answers, so PEM decryption fails instead of prompting the terminal.
int us_no_password_callback(char *buf, int size, int rwflag, void *u);

}