#ifdef _WIN32

#include <windows.h>
#include <wincrypt.h>
#include <openssl/x509.h>
#include <openssl/x509_vfy.h>

// Main function to load system certificates on Windows
extern "C" void us_load_system_certificates_windows(STACK_OF(X509) **system_certs) {
  *system_certs = sk_X509_new_null();
  if (*system_certs == NULL) {
    return;
  }

  // On Windows, load certificates from system certificate stores
  // This follows Node.js's ReadWindowsCertificates implementation
  
  HCERTSTORE cert_store = NULL;
  PCCERT_CONTEXT cert_context = NULL;
  
  // Try to open the ROOT certificate store (using Unicode version for consistency)
  // Note: We use CERT_SYSTEM_STORE_CURRENT_USER by default (0 means current user)
  cert_store = CertOpenSystemStoreW(0, L"ROOT");
  if (cert_store == NULL) {
    return;
  }
  
  // Enumerate certificates in the store
  while ((cert_context = CertEnumCertificatesInStore(cert_store, cert_context)) != NULL) {
    const unsigned char* cert_data = cert_context->pbCertEncoded;
    int cert_len = cert_context->cbCertEncoded;
    
    X509* x509_cert = d2i_X509(NULL, &cert_data, cert_len);
    if (x509_cert != NULL) {
      sk_X509_push(*system_certs, x509_cert);
    }
  }
  
  CertCloseStore(cert_store, 0);
  
  // Also load from CA store for intermediate certificates
  cert_store = CertOpenSystemStoreW(0, L"CA");
  if (cert_store != NULL) {
    cert_context = NULL;
    while ((cert_context = CertEnumCertificatesInStore(cert_store, cert_context)) != NULL) {
      const unsigned char* cert_data = cert_context->pbCertEncoded;
      int cert_len = cert_context->cbCertEncoded;
      
      X509* x509_cert = d2i_X509(NULL, &cert_data, cert_len);
      if (x509_cert != NULL) {
        sk_X509_push(*system_certs, x509_cert);
      }
    }
    CertCloseStore(cert_store, 0);
  }
  
  // Also load from TrustedPeople store (trusted end-entity certificates)
  // Following Node.js's approach for comprehensive certificate loading
  cert_store = CertOpenSystemStoreW(0, L"TrustedPeople");
  if (cert_store != NULL) {
    cert_context = NULL;
    while ((cert_context = CertEnumCertificatesInStore(cert_store, cert_context)) != NULL) {
      const unsigned char* cert_data = cert_context->pbCertEncoded;
      int cert_len = cert_context->cbCertEncoded;
      
      X509* x509_cert = d2i_X509(NULL, &cert_data, cert_len);
      if (x509_cert != NULL) {
        sk_X509_push(*system_certs, x509_cert);
      }
    }
    CertCloseStore(cert_store, 0);
  }
  
  // Also try loading from LOCAL_MACHINE stores for system-wide certificates
  // These require admin rights to modify but are readable by all users
  HCERTSTORE local_store = CertOpenStore(
    CERT_STORE_PROV_SYSTEM_W,
    0,
    0,
    CERT_SYSTEM_STORE_LOCAL_MACHINE | CERT_STORE_READONLY_FLAG,
    L"ROOT"
  );
  if (local_store != NULL) {
    cert_context = NULL;
    while ((cert_context = CertEnumCertificatesInStore(local_store, cert_context)) != NULL) {
      const unsigned char* cert_data = cert_context->pbCertEncoded;
      int cert_len = cert_context->cbCertEncoded;
      
      X509* x509_cert = d2i_X509(NULL, &cert_data, cert_len);
      if (x509_cert != NULL) {
        sk_X509_push(*system_certs, x509_cert);
      }
    }
    CertCloseStore(local_store, 0);
  }
}

#endif // _WIN32