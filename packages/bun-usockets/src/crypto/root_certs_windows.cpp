#ifdef _WIN32

#include <windows.h>
#include <wincrypt.h>
#include <vector>
#include <cstring>
#include <string_view>

// Forward declaration to avoid including OpenSSL headers here
// This prevents conflicts with Windows macros like X509_NAME
// Note: We don't use STACK_OF macro here since we don't have OpenSSL headers

// Structure to hold raw certificate data
struct RawCertificate {
  std::vector<unsigned char> data;
};

// Returns true if the cert can be used for server authentication, based on
// certificate properties. Mirrors Node.js's IsCertTrustedForServerAuth in
// src/crypto/crypto_context.cc.
//
// While there are a variety of certificate properties that can affect how
// trust is computed, the main property is CERT_ENHKEY_USAGE_PROP_ID, which
// is intersected with the certificate's EKU extension (if present).
// The intersection is documented in the Remarks section of
// CertGetEnhancedKeyUsage, and is as follows:
// - No EKU property, and no EKU extension = Trusted for all purposes
// - Either an EKU property, or EKU extension, but not both = Trusted only
//   for the listed purposes
// - Both an EKU property and an EKU extension = Trusted for the set
//   intersection of the listed purposes
// CertGetEnhancedKeyUsage handles this logic, and if an empty set is
// returned, the distinction between the first and third case can be
// determined by GetLastError() returning CRYPT_E_NOT_FOUND.
//
// See:
// https://docs.microsoft.com/en-us/windows/win32/api/wincrypt/nf-wincrypt-certgetenhancedkeyusage
//
// If we run into any errors reading the certificate properties, we fail
// closed.
static bool IsCertTrustedForServerAuth(PCCERT_CONTEXT cert) {
  DWORD usage_size = 0;

  if (!CertGetEnhancedKeyUsage(cert, 0, nullptr, &usage_size)) {
    return false;
  }

  std::vector<BYTE> usage_bytes(usage_size);
  CERT_ENHKEY_USAGE* usage =
      reinterpret_cast<CERT_ENHKEY_USAGE*>(usage_bytes.data());
  if (!CertGetEnhancedKeyUsage(cert, 0, usage, &usage_size)) {
    return false;
  }

  if (usage->cUsageIdentifier == 0) {
    // check GetLastError
    HRESULT error_code = GetLastError();

    switch (error_code) {
      case CRYPT_E_NOT_FOUND:
        return true;
      case S_OK:
        return false;
      default:
        return false;
    }
  }

  // SAFETY: `usage->rgpszUsageIdentifier` is an array of LPSTR (pointer to
  // null-terminated string) of length `usage->cUsageIdentifier`.
  for (DWORD i = 0; i < usage->cUsageIdentifier; ++i) {
    std::string_view eku(usage->rgpszUsageIdentifier[i]);
    if ((eku == szOID_PKIX_KP_SERVER_AUTH) ||
        (eku == szOID_ANY_ENHANCED_KEY_USAGE)) {
      return true;
    }
  }

  return false;
}

// Helper function to load raw certificates from a Windows certificate store.
// Mirrors Node.js's GatherCertsForLocation.
static void GatherCertsForLocation(std::vector<RawCertificate>& raw_certs,
                                   DWORD location,
                                   const wchar_t* store_name) {
  if (!(location == CERT_SYSTEM_STORE_LOCAL_MACHINE ||
        location == CERT_SYSTEM_STORE_LOCAL_MACHINE_GROUP_POLICY ||
        location == CERT_SYSTEM_STORE_LOCAL_MACHINE_ENTERPRISE ||
        location == CERT_SYSTEM_STORE_CURRENT_USER ||
        location == CERT_SYSTEM_STORE_CURRENT_USER_GROUP_POLICY)) {
    return;
  }

  DWORD flags =
      location | CERT_STORE_OPEN_EXISTING_FLAG | CERT_STORE_READONLY_FLAG;

  HCERTSTORE cert_store = CertOpenStore(
    CERT_STORE_PROV_SYSTEM_W,
    0,
    0,
    flags,
    store_name
  );

  if (cert_store == NULL) {
    return;
  }

  PCCERT_CONTEXT cert_context = NULL;
  while ((cert_context = CertEnumCertificatesInStore(cert_store, cert_context)) != NULL) {
    if (!IsCertTrustedForServerAuth(cert_context)) {
      continue;
    }
    RawCertificate raw_cert;
    raw_cert.data.assign(cert_context->pbCertEncoded,
                         cert_context->pbCertEncoded + cert_context->cbCertEncoded);
    raw_certs.push_back(std::move(raw_cert));
  }

  CertCloseStore(cert_store, 0);
}

// Main function to load raw system certificates on Windows.
// Returns certificates as raw DER data to avoid OpenSSL header conflicts.
// Mirrors Node.js's ReadWindowsCertificates: loads roots, intermediates, and
// trusted end-entity certs from the same set of system store locations so
// that chain building succeeds even when servers omit intermediates.
extern void us_load_system_certificates_windows_raw(
    std::vector<RawCertificate>& raw_certs) {
  // Grab the user-added roots.
  GatherCertsForLocation(raw_certs, CERT_SYSTEM_STORE_LOCAL_MACHINE, L"ROOT");
  GatherCertsForLocation(raw_certs, CERT_SYSTEM_STORE_LOCAL_MACHINE_GROUP_POLICY, L"ROOT");
  GatherCertsForLocation(raw_certs, CERT_SYSTEM_STORE_LOCAL_MACHINE_ENTERPRISE, L"ROOT");
  GatherCertsForLocation(raw_certs, CERT_SYSTEM_STORE_CURRENT_USER, L"ROOT");
  GatherCertsForLocation(raw_certs, CERT_SYSTEM_STORE_CURRENT_USER_GROUP_POLICY, L"ROOT");

  // Grab the intermediate certs.
  GatherCertsForLocation(raw_certs, CERT_SYSTEM_STORE_LOCAL_MACHINE, L"CA");
  GatherCertsForLocation(raw_certs, CERT_SYSTEM_STORE_LOCAL_MACHINE_GROUP_POLICY, L"CA");
  GatherCertsForLocation(raw_certs, CERT_SYSTEM_STORE_LOCAL_MACHINE_ENTERPRISE, L"CA");
  GatherCertsForLocation(raw_certs, CERT_SYSTEM_STORE_CURRENT_USER, L"CA");
  GatherCertsForLocation(raw_certs, CERT_SYSTEM_STORE_CURRENT_USER_GROUP_POLICY, L"CA");

  // Grab the user-added trusted server certs. Trusted end-entity certs are
  // only allowed for server auth in the "local machine" store, but not in the
  // "current user" store.
  GatherCertsForLocation(raw_certs, CERT_SYSTEM_STORE_LOCAL_MACHINE, L"TrustedPeople");
  GatherCertsForLocation(raw_certs, CERT_SYSTEM_STORE_LOCAL_MACHINE_GROUP_POLICY, L"TrustedPeople");
  GatherCertsForLocation(raw_certs, CERT_SYSTEM_STORE_LOCAL_MACHINE_ENTERPRISE, L"TrustedPeople");
}

#endif // _WIN32
