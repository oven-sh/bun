function f() {
  const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(Bun.WebView.prototype));
  const d = Object.getOwnPropertyDescriptor(copy, "url");
  return { get: d.get, set: d.set };
}
console.log(typeof f().get, typeof f().set);
