const result = Bun.semver.satisfies("1.5.0", "^1.0.0");
console.log(typeof result, result);
