import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::desktop::web", feature: "Desktop", isCold: true });

export const EndingType = b.enumeration(["transparent", "native"]);
const ofBlob = { type: b.DOMString.utf8.owned.optional, endings: EndingType.default("transparent") };
export const BlobPropertyBag = b.dictionary(ofBlob, { webidl: true, fromJS: true });
export const FilePropertyBag = b.dictionary(
  { lastModified: b.i64.wrap.optional },
  { webidl: true, fromJS: true, extends: BlobPropertyBag },
);

export const resolveBlob = b.fn({ args: { url: b.string.loose.utf8 }, returns: b.any, capability: "js" });
