import { satisfies } from "semver";
import { bench, run } from "../runner.mjs";
const tests = [
  ["~1.2.3", "1.2.3", true],
  ["~1.2", "1.2.0", true],
  ["~1", "1.0.0", true],
  ["~1", "1.2.0", true],
  ["~1", "1.2.999", true],
  ["~0.2.3", "0.2.3", true],
  ["~0.2", "0.2.0", true],
  ["~0.2", "0.2.1", true],
  ["~0 ", "0.0.0", true],

  ["~1.2.3", "1.3.0", false],
  ["~1.2", "1.3.0", false],
  ["~1", "2.0.0", false],
  ["~0.2.3", "0.3.0", false],
  ["~0.2.3", "1.0.0", false],
  ["~0 ", "1.0.0", false],
  ["~0.2", "0.1.0", false],
  ["~0.2", "0.3.0", false],

  ["~3.0.5", "3.3.0", false],

  ["^1.1.4", "1.1.4", true],

  [">=3", "3.5.0", true],
  [">=3", "2.999.999", false],
  [">=3", "3.5.1", true],
  [">=3.x.x", "3.x.x", false],

  ["<6 >= 5", "5.0.0", true],
  ["<6 >= 5", "4.0.0", false],
  ["<6 >= 5", "6.0.0", false],
  ["<6 >= 5", "6.0.1", false],

  [">2", "3", false],
  [">2", "2.1", false],
  [">2", "2", false],
  [">2", "1.0", false],
  [">1.3", "1.3.1", false],
  [">1.3", "2.0.0", true],
  [">2.1.0", "2.2.0", true],
  ["<=2.2.99999", "2.2.0", true],
  [">=2.1.99999", "2.2.0", true],
  ["<2.2.99999", "2.2.0", true],
  [">2.1.99999", "2.2.0", true],
  [">1.0.0", "2.0.0", true],
  ["1.0.0", "1.0.0", true],
  ["1.0.0", "2.0.0", false],

  ["1.0.0 || 2.0.0", "1.0.0", true],
  ["2.0.0 || 1.0.0", "1.0.0", true],
  ["1.0.0 || 2.0.0", "2.0.0", true],
  ["2.0.0 || 1.0.0", "2.0.0", true],
  ["2.0.0 || >1.0.0", "2.0.0", true],

  [">1.0.0 <2.0.0 <2.0.1 >1.0.1", "1.0.2", true],

  ["2.x", "2.0.0", true],
  ["2.x", "2.1.0", true],
  ["2.x", "2.2.0", true],
  ["2.x", "2.3.0", true],
  ["2.x", "2.1.1", true],
  ["2.x", "2.2.2", true],
  ["2.x", "2.3.3", true],

  ["<2.0.1 >1.0.0", "2.0.0", true],
  ["<=2.0.1 >=1.0.0", "2.0.0", true],

  ["^2", "2.0.0", true],
  ["^2", "2.9.9", true],
  ["~2", "2.0.0", true],
  ["~2", "2.1.0", true],
  ["~2.2", "2.2.1", true],

  ["2.1.0 || > 2.2 || >3", "2.1.0", true],
  [" > 2.2 || >3 || 2.1.0", "2.1.0", true],
  [" > 2.2 || 2.1.0 || >3", "2.1.0", true],
  ["> 2.2 || 2.1.0 || >3", "2.3.0", true],
  ["> 2.2 || 2.1.0 || >3", "2.2.1", false],
  ["> 2.2 || 2.1.0 || >3", "2.2.0", false],
  ["> 2.2 || 2.1.0 || >3", "2.3.0", true],
  ["> 2.2 || 2.1.0 || >3", "3.0.1", true],
  ["~2", "2.0.0", true],
  ["~2", "2.1.0", true],

  ["1.2.0 - 1.3.0", "1.2.2", true],
  ["1.2 - 1.3", "1.2.2", true],
  ["1 - 1.3", "1.2.2", true],
  ["1 - 1.3", "1.3.0", true],
  ["1.2 - 1.3", "1.3.1", true],
  ["1.2 - 1.3", "1.4.0", false],
  ["1 - 1.3", "1.3.1", true],

  ["1.2 - 1.3 || 5.0", "6.4.0", false],
  ["1.2 - 1.3 || 5.0", "1.2.1", true],
  ["5.0 || 1.2 - 1.3", "1.2.1", true],
  ["1.2 - 1.3 || 5.0", "5.0", false],
  ["5.0 || 1.2 - 1.3", "5.0", false],
  ["1.2 - 1.3 || 5.0", "5.0.2", true],
  ["5.0 || 1.2 - 1.3", "5.0.2", true],
  ["1.2 - 1.3 || 5.0", "5.0.2", true],
  ["5.0 || 1.2 - 1.3", "5.0.2", true],
  ["5.0 || 1.2 - 1.3 || >8", "9.0.2", true],
];

bench("semver.satisfies x " + tests.length, () => {
  for (const [range, version, expected] of tests) {
    if (satisfies(version, range) !== expected) {
      throw new Error("Unexpected result for " + range + " " + version);
    }
  }
});

if (typeof Bun !== "undefined") {
  const satisfies = Bun.semver.satisfies;
  bench("Bun.semver.satisfies x " + tests.length, () => {
    for (const [range, version, expected] of tests) {
      if (satisfies(version, range) !== expected) {
        throw new Error("Unexpected result for " + range + " " + version);
      }
    }
  });
}

bench("semver.satisfies", () => {
  const [range, version, expected] = tests[0];
  if (satisfies(version, range) !== expected) {
    throw new Error("Unexpected result for " + range + " " + version);
  }
});
if (typeof Bun !== "undefined") {
  const satisfies = Bun.semver.satisfies;
  bench("Bun.semver.satisfies", () => {
    const [range, version, expected] = tests[0];
    if (satisfies(version, range) !== expected) {
      throw new Error("Unexpected result for " + range + " " + version);
    }
  });
}

await run();
