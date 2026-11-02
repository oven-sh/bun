export function cut() {
  Object.setPrototypeOf(import.meta, { inherited: 1 });
}
export function ask() {
  try {
    return typeof import.meta.resolve("./x.mjs") + " " + typeof import.meta.url;
  } catch (error) {
    return error.constructor.name + ": " + error.message + " " + typeof import.meta.url;
  }
}
