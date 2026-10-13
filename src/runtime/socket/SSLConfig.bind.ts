import * as b from "../../codegen/bindgen-lib.ts";

export const SSLConfigSingleFile = b.union("SSLConfigSingleFile", {
  string: b.string,
  buffer: b.arrayBuffer,
  file: b.blob,
});

export const SSLConfigFile = b.union("SSLConfigFile", {
  none: b.null,
  string: b.string,
  buffer: b.arrayBuffer,
  file: b.blob,
  array: b.array(SSLConfigSingleFile),
});

export const ALPNProtocols = b.union("ALPNProtocols", {
  none: b.null,
  string: b.string,
  buffer: b.arrayBuffer,
});

export const SSLConfig = b.dictionary(
  {
    name: "SSLConfig",
    userFacingName: "TLSOptions",
    fromJS: true,
  },
  {
    passphrase: b.string.nullable,
    dhParamsFile: {
      type: b.string.nullable,
      internalName: "dh_params_file",
    },
    serverName: {
      type: b.string.nullable,
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
      type: b.string.nullable,
      internalName: "key_file",
    },
    certFile: {
      type: b.string.nullable,
      internalName: "cert_file",
    },
    caFile: {
      type: b.string.nullable,
      internalName: "ca_file",
    },
    ALPNProtocols: {
      type: ALPNProtocols,
      internalName: "alpn_protocols",
    },
    ciphers: b.string.nullable,
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
    sigalgs: b.string.nullable,
    ecdhCurve: {
      type: b.string.nullable,
      internalName: "ecdh_curve",
    },
  },
);
