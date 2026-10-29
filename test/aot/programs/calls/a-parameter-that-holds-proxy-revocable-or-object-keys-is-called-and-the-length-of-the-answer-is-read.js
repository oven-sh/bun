function g(f) {
  return f({}, {}).length;
}
console.log(g(Proxy.revocable), g(Object.keys));
