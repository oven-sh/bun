import * as b from "../../codegen/bindgen-lib.ts";

export const TLSOptionsSingleFile = b.union({
  string: b.string,
  buffer: b.bufferSource.arrayBuffer,
  file: b.blob,
});

export const TLSOptionsFile = b.union({
  none: b.null,
  string: b.string,
  buffer: b.bufferSource.arrayBuffer,
  file: b.blob,
  array: b.array(TLSOptionsSingleFile),
});

export const ALPNProtocols = b.union({
  none: b.null,
  string: b.string,
  buffer: b.bufferSource.arrayBuffer,
});

/** One of node:tls's names, such as "TLSv1.2", or the protocol code node:tls itself passes. */
export const TLSVersion = b.union({
  none: b.null,
  name: b.string,
  code: b.i32.allowBigInt,
});

export const TLSOptions = b.dictionary(
  {
    passphrase: b.string.nullable,
    dhParamsFile: b.string.nullable,
    serverName: { type: b.string.nullable, altNames: ["servername"] },
    lowMemoryMode: b.bool.default(false),
    rejectUnauthorized: b.bool.nullable,
    requestCert: b.bool.default(false),
    ca: TLSOptionsFile,
    cert: TLSOptionsFile,
    key: TLSOptionsFile,
    secureOptions: b.u32.allowBigInt.default(0),
    minVersion: { type: TLSVersion, rustName: "ssl_min_version" },
    maxVersion: { type: TLSVersion, rustName: "ssl_max_version" },
    keyFile: b.string.nullable,
    certFile: b.string.nullable,
    caFile: b.string.nullable,
    ALPNProtocols,
    ciphers: b.string.nullable,
    clientRenegotiationLimit: b.u32.allowBigInt.default(0),
    clientRenegotiationWindow: b.u32.allowBigInt.default(0),
    crl: TLSOptionsFile,
    allowPartialTrustChain: b.bool.default(false),
    sessionTimeout: b.i32.allowBigInt.default(0),
    sigalgs: b.string.nullable,
    ecdhCurve: b.string.nullable,
  },
  { fromJS: true },
);
