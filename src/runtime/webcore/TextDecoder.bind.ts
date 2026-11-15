import * as b from "../../codegen/bindgen-lib.ts";

export const TextDecoderOptions = b.dictionary(
  {
    fatal: b.bool.loose.default(false),
    ignoreBOM: b.bool.loose.default(false),
  },
  { allowArray: true },
);

export const TextDecodeOptions = b.dictionary({ stream: b.bool.loose.default(false) }, { allowArray: true });

export const TextDecoder = b.class({
  rustPath: "crate::webcore::TextDecoder",
  construct: {
    args: { label: b.string.loose.utf8.optional, options: TextDecoderOptions.nullable.default({}) },
    expected: { options: ["object"] },
    capability: "heap",
    throws: true,
  },
  proto: {
    decode: {
      args: {
        /** A decoder measures the bytes and then reads them again. */
        input: b.bytes({ from: ["buffer"], shared: "copied" }).optional,
        options: TextDecodeOptions.nullable.default({}),
      },
      expected: { input: "TextDecoder.decode expects an ArrayBuffer or TypedArray", options: ["object"] },
      returns: b.string.local,
      capability: "heap",
      throws: true,
      mutates: true,
    },
    encoding: { getter: b.string.local, cache: true, capability: "heap" },
    fatal: { getter: b.bool, pure: true },
    ignoreBOM: { getter: b.bool, pure: true },
  },
});
