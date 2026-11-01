function f() {
  const d = Object.getOwnPropertyDescriptor(ReadableStreamDefaultReader.prototype, "closed");
  const o = Object.defineProperty({}, "closed", d);
  const again = Object.getOwnPropertyDescriptor(o, "closed");
  return { get: again.get };
}
console.log(typeof f().get);
