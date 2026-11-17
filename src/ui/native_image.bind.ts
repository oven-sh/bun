import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::image", feature: "Desktop", membersInTable: false, isCold: true });

const js = { capability: "js", throws: true } as const;
const buffer = b.any.returning("Buffer");
const size = b.f64.loose.optional;

export const ImageSize = b.dictionary({ width: b.u32, height: b.u32 });
export const ResizeOptions = b.dictionary({ width: size, height: size });
export const CropArea = b.dictionary({ x: b.f64.loose, y: b.f64.loose, width: b.f64.loose, height: b.f64.loose });

export const NativeImage = b.class({
  rustPath: "crate::image::NativeImage",
  construct: "illegal",
  configurable: true,
  enumerable: false,
  estimatedSize: true,
  proto: {
    isEmpty: { returns: b.bool, ...js },
    getSize: { returns: ImageSize, ...js },
    getAspectRatio: { returns: b.f64, ...js },
    getScaleFactors: { returns: b.array(b.u8), ...js },
    toPNG: { returns: buffer, rustName: "to_png", ...js },
    toJPEG: { args: { quality: b.f64.loose }, returns: buffer, rustName: "to_jpeg", ...js },
    toBitmap: { returns: buffer, ...js },
    getBitmap: { returns: buffer, rustName: "to_bitmap", ...js },
    toDataURL: { returns: b.string.utf8, rustName: "to_data_url", ...js },
    resize: { args: { options: ResizeOptions }, returns: b.self, passThis: true, ...js },
    crop: { args: { rect: CropArea }, returns: b.self, ...js },
    addRepresentation: {},
    isTemplateImage: { returns: b.bool },
    setTemplateImage: { args: { option: b.bool.loose } },
    isMacTemplateImage: { getter: b.bool.loose, setter: true, enumerable: true },
  },
});

export const UiImages = b.interface("UiImages", {
  ofModule: true,
  name: "nativeImage",
  namespace: true,
  static: {
    createEmpty: { returns: NativeImage, ...js },
    createFromBuffer: { args: { buffer: b.bytes({ from: ["buffer"], held: "copied" }) }, returns: NativeImage, ...js },
    createFromDataURL: {
      args: { dataURL: b.string.utf8 },
      returns: NativeImage,
      rustName: "create_from_data_url",
      ...js,
    },
    createFromPath: { args: { path: b.string.utf8.otherAsNull }, returns: NativeImage, ...js },
    createFromBitmap: {
      args: { buffer: b.bytes({ from: ["buffer"], held: "copied" }), options: ImageSize },
      returns: NativeImage,
      ...js,
    },
    createFromNamedImage: { args: { imageName: b.string.utf8 }, returns: NativeImage, ...js },
    createThumbnailFromPath: {
      args: { path: b.string.utf8, size: ResizeOptions },
      returns: b.any.returning("Promise"),
      rejects: true,
      ...js,
    },
  },
});
