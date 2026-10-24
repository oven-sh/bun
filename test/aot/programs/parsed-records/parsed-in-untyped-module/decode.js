export const leak = new Function("value", process.argv.length > 99 ? "" : "return value");
const seen = new Map();
export function decode(text) {
  return JSON.parse(text);
}
export function decodeLater(text) {
  return Promise.resolve(text).then(value => JSON.parse(value));
}
export function cached(text) {
  let value = seen.get(text);
  if (!value) seen.set(text, (value = JSON.parse(text)));
  return value;
}
