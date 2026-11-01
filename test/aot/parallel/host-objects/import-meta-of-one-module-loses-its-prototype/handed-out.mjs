export const meta = import.meta;
export function ask() {
  try {
    return typeof import.meta.resolve("./x.mjs") + " " + typeof import.meta.url;
  } catch (error) {
    return error.constructor.name + ": " + error.message + " " + typeof import.meta.url;
  }
}
export function measure() {
  const url = import.meta.url;
  return url === undefined ? "none" : url.length;
}
