import type { FeatureName } from "../vocabulary.ts";

export const tlsSocketFeatures: readonly FeatureName[] = ["TlsSockets", "Tls", "Buffer"];

export const s3RequestFeatures: readonly FeatureName[] = [
  "S3Client",
  "S3Responses",
  "BrotliDecoder",
  "X509",
  ...tlsSocketFeatures,
];

export const arrayBufferViewFeatures: readonly FeatureName[] = [
  "DataView",
  "Int8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float16Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
];

export const externalValueFeatures: readonly FeatureName[] = [
  "ExternalSerializedValues",
  "StructuredClone",
  ...s3RequestFeatures,
  "HttpClient",
  "Bodies",
  "WebCrypto",
  "NetAddresses",
  "RegExpUnicodeProperties",
  ...arrayBufferViewFeatures,
];
