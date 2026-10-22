const result = Bun.semver.order("1.0.0", "2.0.0");
console.log(typeof result, result + 1);
