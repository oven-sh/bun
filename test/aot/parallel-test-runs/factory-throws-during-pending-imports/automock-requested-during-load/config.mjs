export const kind = "real";
export function url(path) {
  return base + path;
}
globalThis.begin();
const settings = await globalThis.settings;
export const base = settings.base;
