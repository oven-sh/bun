import * as bg from "bindgenv2";

export const SSLConfigSingleFile = bg.Union("SSLConfigSingleFile", {
  string: bg.String,
  buffer: bg.ArrayBuffer,
  file: bg.Blob,
});

export const SSLConfigFile = bg.Union("SSLConfigFile", {
  none: bg.Null,
  string: bg.String,
  buffer: bg.ArrayBuffer,
  file: bg.Blob,
  array: bg.Array(SSLConfigSingleFile),
});

export const ALPNProtocols = bg.Union("ALPNProtocols", {
  none: bg.Null,
  string: bg.String,
  buffer: bg.ArrayBuffer,
});

export const SSLConfig = bg.Dictionary(
  {
    name: "SSLConfig",
    userFacingName: "TLSOptions",
    generateConversionFunction: true,
  },
  {
    passphrase: bg.Nullable(bg.String),
    dhParamsFile: {
      type: bg.Nullable(bg.String),
      internalName: "dh_params_file",
    },
    serverName: {
      type: bg.Nullable(bg.String),
      internalName: "server_name",
      altNames: ["servername"],
    },
    lowMemoryMode: {
      type: bg.Bool,
      default: false,
      internalName: "low_memory_mode",
    },
    rejectUnauthorized: {
      type: bg.Nullable(bg.Bool),
      internalName: "reject_unauthorized",
    },
    requestCert: {
      type: bg.Bool,
      default: false,
      internalName: "request_cert",
    },
    ca: SSLConfigFile,
    cert: SSLConfigFile,
    key: SSLConfigFile,
    secureOptions: {
      type: bg.Uint32,
      default: 0,
      internalName: "secure_options",
    },
    keyFile: {
      type: bg.Nullable(bg.String),
      internalName: "key_file",
    },
    certFile: {
      type: bg.Nullable(bg.String),
      internalName: "cert_file",
    },
    caFile: {
      type: bg.Nullable(bg.String),
      internalName: "ca_file",
    },
    ALPNProtocols: {
      type: ALPNProtocols,
      internalName: "alpn_protocols",
    },
    ciphers: bg.Nullable(bg.String),
    clientRenegotiationLimit: {
      type: bg.Uint32,
      default: 0,
      internalName: "client_renegotiation_limit",
    },
    clientRenegotiationWindow: {
      type: bg.Uint32,
      default: 0,
      internalName: "client_renegotiation_window",
    },
  },
);
