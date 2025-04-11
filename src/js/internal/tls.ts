import { isArrayBuffer, isTypedArray } from "node:util/types";

export function isValidTLSArray(obj) {
  if (typeof obj === "string" || isTypedArray(obj) || isArrayBuffer(obj) || $inheritsBlob(obj)) return true;
  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) {
      const item = obj[i];
      if (typeof item !== "string" && !isTypedArray(item) && !isArrayBuffer(item) && !$inheritsBlob(item)) return false;
    }
    return true;
  }
  return false;
}
