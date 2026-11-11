export const kind = "real";
export function url(path) {
  return base + path;
}
const settings = await new Promise(done => setTimeout(done, 300, { base: "http://host/" }));
export const base = settings.base;
