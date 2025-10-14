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
  },
);
