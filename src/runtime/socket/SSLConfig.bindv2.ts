import * as b from "bindgenv2";

export const SSLConfigSingleFile = b.union("SSLConfigSingleFile", {
  string: b.String,
  buffer: b.ArrayBuffer,
  file: b.Blob,
});

export const SSLConfigFile = b.union("SSLConfigFile", {
  none: b.null,
  string: b.String,
  buffer: b.ArrayBuffer,
  file: b.Blob,
  array: b.Array(SSLConfigSingleFile),
});

export const ALPNProtocols = b.union("ALPNProtocols", {
  none: b.null,
  string: b.String,
  buffer: b.ArrayBuffer,
});

/** `certificateCompression: boolean | ("brotli" | "zlib" | "zstd")[]` */
export const CertificateCompression = b.union("CertificateCompression", {
  none: b.null,
  boolean: b.bool,
  array: b.Array(b.String),
});

/** `applicationSettings: boolean | 17513 | 17613` (the ALPS extension codepoint) */
export const ApplicationSettings = b.union("ApplicationSettings", {
  none: b.null,
  boolean: b.bool,
  codepoint: b.u16,
});

export const SSLConfig = b.dictionary(
  {
    name: "SSLConfig",
    userFacingName: "TLSOptions",
    generateConversionFunction: true,
  },
  {
    passphrase: b.String.nullable,
    dhParamsFile: {
      type: b.String.nullable,
      internalName: "dh_params_file",
    },
    serverName: {
      type: b.String.nullable,
      internalName: "server_name",
      altNames: ["servername"],
    },
    lowMemoryMode: {
      type: b.bool,
      default: false,
      internalName: "low_memory_mode",
    },
    rejectUnauthorized: {
      type: b.bool.nullable,
      internalName: "reject_unauthorized",
    },
    requestCert: {
      type: b.bool,
      default: false,
      internalName: "request_cert",
    },
    ca: SSLConfigFile,
    cert: SSLConfigFile,
    key: SSLConfigFile,
    secureOptions: {
      type: b.u32,
      default: 0,
      internalName: "secure_options",
    },
    minVersion: {
      type: b.i32,
      default: 0,
      internalName: "ssl_min_version",
    },
    maxVersion: {
      type: b.i32,
      default: 0,
      internalName: "ssl_max_version",
    },
    keyFile: {
      type: b.String.nullable,
      internalName: "key_file",
    },
    certFile: {
      type: b.String.nullable,
      internalName: "cert_file",
    },
    caFile: {
      type: b.String.nullable,
      internalName: "ca_file",
    },
    ALPNProtocols: {
      type: ALPNProtocols,
      internalName: "alpn_protocols",
    },
    ciphers: b.String.nullable,
    clientRenegotiationLimit: {
      type: b.u32,
      default: 0,
      internalName: "client_renegotiation_limit",
    },
    clientRenegotiationWindow: {
      type: b.u32,
      default: 0,
      internalName: "client_renegotiation_window",
    },
    crl: SSLConfigFile,
    allowPartialTrustChain: {
      type: b.bool,
      default: false,
      internalName: "allow_partial_trust_chain",
    },
    sessionTimeout: {
      type: b.i32,
      default: 0,
      internalName: "session_timeout",
    },
    sigalgs: b.String.nullable,
    ecdhCurve: {
      type: b.String.nullable,
      internalName: "ecdh_curve",
    },
    // ClientHello fingerprint options; only fetch applies them (src/http/tls_fingerprint.rs).
    ja3: b.String.nullable,
    grease: b.bool.nullable,
    permuteExtensions: {
      type: b.bool.nullable,
      internalName: "permute_extensions",
    },
    certificateCompression: {
      type: CertificateCompression,
      internalName: "certificate_compression",
    },
    applicationSettings: {
      type: ApplicationSettings,
      internalName: "application_settings",
    },
    echGrease: {
      type: b.bool.nullable,
      internalName: "ech_grease",
    },
    ocspStapling: {
      type: b.bool.nullable,
      internalName: "ocsp_stapling",
    },
    signedCertificateTimestamps: {
      type: b.bool.nullable,
      internalName: "signed_certificate_timestamps",
    },
    sessionTickets: {
      type: b.bool.nullable,
      internalName: "session_tickets",
    },
  },
);
