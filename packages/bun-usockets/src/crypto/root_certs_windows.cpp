#ifdef _WIN32

#include <windows.h>
#include <wincrypt.h>
#include <vector>
#include <cstring>

// Forward declaration to avoid including OpenSSL headers here
// This prevents conflicts with Windows macros like X509_NAME
// Note: We don't use STACK_OF macro here since we don't have OpenSSL headers

// Structure to hold raw certificate data
struct RawCertificate {
  std::vector<unsigned char> data;
};

// Helper function to load raw certificates from a Windows certificate store
static void LoadRawCertsFromStore(std::vector<RawCertificate>& raw_certs, 
                                  DWORD store_flags, 
                                  const wchar_t* store_name) {
  HCERTSTORE cert_store = CertOpenStore(
    CERT_STORE_PROV_SYSTEM_W,
    0,
    0,
    store_flags | CERT_STORE_READONLY_FLAG,
    store_name
  );
  
  if (cert_store == NULL) {
    return;
  }
  
  PCCERT_CONTEXT cert_context = NULL;
  while ((cert_context = CertEnumCertificatesInStore(cert_store, cert_context)) != NULL) {
    RawCertificate raw_cert;
    raw_cert.data.assign(cert_context->pbCertEncoded, 
                        cert_context->pbCertEncoded + cert_context->cbCertEncoded);
    raw_certs.push_back(std::move(raw_cert));
  }
  
  CertCloseStore(cert_store, 0);
}

// Main function to load raw system certificates on Windows
// Returns certificates as raw DER data to avoid OpenSSL header conflicts
extern void us_load_system_certificates_windows_raw(
    std::vector<RawCertificate>& raw_certs) {
  // Load only from ROOT by default
  LoadRawCertsFromStore(raw_certs, CERT_SYSTEM_STORE_CURRENT_USER, L"ROOT");
  LoadRawCertsFromStore(raw_certs, CERT_SYSTEM_STORE_LOCAL_MACHINE, L"ROOT");
}

#endif // _WIN32