import * as b from "../codegen/bindgen-lib.ts";
import { NativeImage } from "./native_image.bind.ts";

export default b.module({ rustPath: "crate::clipboard", feature: "Desktop", isCold: true });

const js = { capability: "js", throws: true } as const;
const type = b.string.utf8.optional;

export const ClipboardData = b.dictionary({
  text: b.string.loose.utf8.nullable,
  html: b.string.loose.utf8.nullable,
  image: b.any.falsyAsNull,
});

export const UiClipboard = b.interface("UiClipboard", {
  ofModule: true,
  name: "clipboard",
  namespace: true,
  static: {
    readText: { args: { type }, returns: b.string.utf8, ...js },
    readImage: { args: { type }, returns: NativeImage, ...js },
    readHTML: { args: { type }, returns: b.string.utf8, rustName: "read_html", ...js },
    readFilePaths: { args: { type }, returns: b.array(b.string.utf8), ...js },
    write: { args: { data: ClipboardData, type }, rustName: "write_data", ...js },
    writeText: { args: { text: b.string.loose.utf8, type }, ...js },
    writeImage: { args: { image: b.any, type }, ...js },
    availableFormats: { args: { type }, returns: b.array(b.string.utf8), ...js },
    clear: { args: { type }, ...js },
  },
});
