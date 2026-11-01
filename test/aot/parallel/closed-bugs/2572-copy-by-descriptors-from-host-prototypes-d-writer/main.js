function f() {
  const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(WritableStreamDefaultWriter.prototype));
  const kept = { ready: Object.getOwnPropertyDescriptor(copy, "ready").get, closed: Object.getOwnPropertyDescriptor(copy, "closed").get };
  return kept;
}
console.log(typeof f().ready, typeof f().closed);
