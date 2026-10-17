export function bytes(name) {
  return name.startsWith("right:") ? new Uint8Array(name.length) : "text of " + name;
}
export function count(name) {
  return name === "ba" || name === "ca" || name === "cb" ? "1" : "-1";
}
export function row(name) {
  return name === "a" ? null : [name];
}
