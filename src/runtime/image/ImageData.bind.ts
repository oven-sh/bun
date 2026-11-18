import * as b from "../../codegen/bindgen-lib.ts";

export const PredefinedColorSpace = b.enumeration(["srgb", "srgb-linear", "display-p3", "display-p3-linear"]);
export const ImageDataPixelFormat = b.enumeration(["rgba-unorm8", "rgba-float16"]);

/** https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#imagedata */
export const ImageData = b.class({
  rustPath: "crate::image::ImageData",
  configurable: true,
  construct: {
    passStructure: true,
    /** Or `(data, width, height?, settings?)`. WebIDL chooses by the number of arguments too, which `b.overloads` does not. */
    args: { width: b.any, height: b.any, rest: b.any.variadic },
    capability: "js",
    throws: true,
    requiredArguments: 2,
    length: 2,
  },
  internalFields: ["data"],
  proto: {
    width: { getter: b.u32, pure: true },
    height: { getter: b.u32, pure: true },
    data: { internalField: "data" },
    pixelFormat: { getter: ImageDataPixelFormat },
    colorSpace: { getter: PredefinedColorSpace },
  },
  calledFromCpp: {
    width: { returns: b.u32 },
    colorSpaceTag: { returns: b.u8 },
  },
  calledFromRust: {
    setData: { args: { data: b.any } },
    allocateData: { args: { isFloat16: b.bool, length: b.usize }, throws: true },
  },
});
