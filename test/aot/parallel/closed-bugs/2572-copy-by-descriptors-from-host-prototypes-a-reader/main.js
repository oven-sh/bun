function f() {
  const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(ReadableStreamDefaultReader.prototype));
  const d = Object.getOwnPropertyDescriptor(copy, "closed");
  return { get: d.get };
}
console.log(typeof f().get);
