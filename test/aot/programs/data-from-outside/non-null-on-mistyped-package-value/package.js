function make(name) {
  return {
    size: name === "right" ? 2 : "size of " + name,
    pair() {
      return name === "right" ? [new Uint8Array(1), new Uint8Array(2)] : "pair of " + name;
    },
    count() {
      return "count of " + name;
    },
  };
}
export function find(name) {
  return name === "nothing" ? null : make(name);
}
export const holder = { inner: make("inner") };
