const { isTypedArray, isArrayBuffer } = require("node:util/types");

function isValidTLSArray(obj) {
  if (typeof obj === "string" || isTypedArray(obj) || isArrayBuffer(obj) || $inheritsBlob(obj)) return true;
  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) {
      const item = obj[i];
      if (item && typeof item === "object" && "pem" in item) return isValidTLSArray(item.pem);
      if (typeof item !== "string" && !isTypedArray(item) && !isArrayBuffer(item) && !$inheritsBlob(item)) return false;
    }

    return true;
  }

  return false;
}

function normalizeTLSArray(obj) {
  if (obj == null || obj === false) return undefined;
  if (Array.isArray(obj)) {
    return obj.map(normalizeTLSArray);
  }
  if (obj && typeof obj === "object" && "pem" in obj) {
    return normalizeTLSArray(obj.pem);
  }
  return obj;
}

export { isValidTLSArray, normalizeTLSArray };
