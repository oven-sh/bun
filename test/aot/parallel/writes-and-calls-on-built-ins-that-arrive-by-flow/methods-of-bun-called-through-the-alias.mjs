function outer() {
  const g = globalThis;
  return () => [g.Bun.escapeHTML("<a>"), g.Bun.semver.satisfies("1.2.3", "^1.0.0"), g.btoa("hi"), g.structuredClone({ a: 1 }).a, new g.URL("http://a.example/b").pathname, g.Bun.hash.crc32("a")];
}
console.log(outer()().join(" "));
