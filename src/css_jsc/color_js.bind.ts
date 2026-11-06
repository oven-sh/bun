import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::color_js" });

export const ColorChannels = b.dictionary(
  {
    r: b.f64,
    g: b.f64,
    b: b.f64,
    /** From 0 to 1. What is not a number is opaque. */
    a: b.f64.otherAsNull,
  },
  { allowArray: true, fromJS: true, reportedAs: "input" },
);

/**
 * `list` and `buffer` hold 3 or 4 numbers, which are read one at a time. A `DataView` has no elements: it is read as
 * `channels`. `text` is a string, or any other primitive converted to one.
 */
export const ColorInput = b.union({
  missing: b.undefined,
  number: b.f64,
  list: b.jsArray,
  buffer: b.bufferSource.allowShared,
  channels: ColorChannels,
  text: b.string.loose.utf8,
});

export const OutputColorFormat = b.enumeration({
  Ansi: "ansi",
  Ansi16: ["ansi-16", "ansi_16"],
  Ansi16m: ["ansi-16m", "ansi_16m", "ansi-24bit", "ansi-truecolor"],
  Ansi256: ["ansi-256", "ansi_256", "ansi256"],
  Css: "css",
  Hex: "hex",
  HexUpper: "HEX",
  Hsl: "hsl",
  Lab: "lab",
  Number: "number",
  Rgb: "rgb",
  Rgba: "rgba",
  RgbArray: "[rgb]",
  RgbaArray: ["[rgba]", "[r,g,b,a]"],
  RgbObject: ["{rgb}", "{r,g,b}"],
  RgbaObject: "{rgba}",
});

export const ColorOutputChannels = b.dictionary({ r: b.u8, g: b.u8, b: b.u8, a: b.f64.optional });
export const ColorOutput = b.union({
  text: b.string,
  /** As the CSS printer writes it. */
  css: b.string.utf8,
  number: b.u32,
  /** Of 3 or 4 bytes. */
  list: b.jsArray,
  channels: ColorOutputChannels,
});

const formats = OutputColorFormat.spellings.flat().map(format => `'${format}'`);

export const color = b.fn({
  args: { input: ColorInput, outputFormat: OutputColorFormat.nullable.default("css") },
  expected: { outputFormat: `outputFormat must be one of ${formats.slice(0, -1).join(", ")} or ${formats.at(-1)}` },
  returns: ColorOutput.nullable,
  capability: "js",
  throws: true,
});
