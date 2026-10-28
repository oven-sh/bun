function define() {
  const key = Symbol("test");
  const holder = {};
  Object.defineProperty(holder, key, { value: "symbol value" });
  return holder[key];
}
console.log(define(), define());
