export function bytes(name) {
  return name.startsWith("right:") ? new Uint8Array(name.length) : "text of " + name;
}
export function count(name) {
  return "count of " + name;
}
export function soon(name) {
  return Promise.resolve(["list of " + name]);
}
