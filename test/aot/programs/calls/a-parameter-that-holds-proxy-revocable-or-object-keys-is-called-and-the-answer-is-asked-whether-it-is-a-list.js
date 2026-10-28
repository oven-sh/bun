function g(f) {
  return Array.isArray(f({}, {}));
}
console.log(g(Proxy.revocable), g(Object.keys));
