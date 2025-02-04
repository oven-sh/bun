/**
 * Browser polyfill for the `"buffer"` module.
 *
 * Imported on usage in `bun build --target=browser`
 */
export * from "./node_modules/buffer";
export { Buffer as default } from "./node_modules/buffer";
export { Buffer } from "./node_modules/buffer";
export var kStringMaxLength = 2 ** 32 - 1;
export var { Blob, File, atob, btoa } = globalThis;
export var { createObjectURL } = URL;
export var isAscii = buf => {
  if (ArrayBuffer.isView(buf)) {
    return buf.every(byte => byte < 128);
  } else {
    return buf.split("").every(char => char.charCodeAt(0) < 128);
  }
};
export var isUtf8 = buf => {
  throw new Error("Not implemented");
};
export var constants = {
  __proto__: null,
  MAX_LENGTH: kStringMaxLength,
  MAX_STRING_LENGTH: kStringMaxLength,
  BYTES_PER_ELEMENT: 1,
};

export function resolveObjectURL(url) {
  throw new Error("Not implemented");
}

export function transcode(buf, from, to) {
  throw new Error("Not implemented");
}
