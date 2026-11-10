function use(b) {
  return b.semver.satisfies("1.2.3", "^1.0.0");
}
console.log(use(Bun));
