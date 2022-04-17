import type { ByteBuffer } from "peechy";

type byte = number;
type float = number;
type int = number;
type alphanumeric = string;
type uint = number;
type int8 = number;
type lowp = number;
type int16 = number;
type int32 = number;
type float32 = number;
type uint16 = number;
type uint32 = number;
export interface StringPointer {
  offset: uint32;
  length: uint32;
}

export interface JavascriptBundledPart {
  code: StringPointer;
  dependencies_offset: uint32;
  dependencies_length: uint32;
  exports_offset: uint32;
  exports_length: uint32;
  from_module: uint32;
}

export interface JavascriptBundledModule {
  path: StringPointer;
  parts_offset: uint32;
  parts_length: uint32;
  exports_offset: uint32;
  exports_length: uint32;
  package_id: uint32;
  path_extname_length: byte;
}

export interface JavascriptBundledPackage {
  name: StringPointer;
  version: StringPointer;
  hash: uint32;
  modules_offset: uint32;
  modules_length: uint32;
}

export interface JavascriptBundle {
  modules: JavascriptBundledModule[];
  packages: JavascriptBundledPackage[];
  parts: JavascriptBundledPart[];
  export_names: StringPointer[];
  export_parts: Uint32Array;
  etag: Uint8Array;
  generated_at: uint32;
  import_from_name: Uint8Array;
  manifest_string: Uint8Array;
}

export interface JavascriptBundleContainer {
  bundle_format_version?: uint32;
  bundle?: JavascriptBundle;
  code_length?: uint32;
}

export declare function encodeStringPointer(
  message: StringPointer,
  bb: ByteBuffer
): void;
export declare function decodeStringPointer(buffer: ByteBuffer): StringPointer;
export declare function encodeJavascriptBundledPart(
  message: JavascriptBundledPart,
  bb: ByteBuffer
): void;
export declare function decodeJavascriptBundledPart(
  buffer: ByteBuffer
): JavascriptBundledPart;
export declare function encodeJavascriptBundledModule(
  message: JavascriptBundledModule,
  bb: ByteBuffer
): void;
export declare function decodeJavascriptBundledModule(
  buffer: ByteBuffer
): JavascriptBundledModule;
export declare function encodeJavascriptBundledPackage(
  message: JavascriptBundledPackage,
  bb: ByteBuffer
): void;
export declare function decodeJavascriptBundledPackage(
  buffer: ByteBuffer
): JavascriptBundledPackage;
export declare function encodeJavascriptBundle(
  message: JavascriptBundle,
  bb: ByteBuffer
): void;
export declare function decodeJavascriptBundle(
  buffer: ByteBuffer
): JavascriptBundle;
export declare function encodeJavascriptBundleContainer(
  message: JavascriptBundleContainer,
  bb: ByteBuffer
): void;
export declare function decodeJavascriptBundleContainer(
  buffer: ByteBuffer
): JavascriptBundleContainer;
