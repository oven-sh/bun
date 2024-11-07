import braces from "braces";
import { bench, group, run } from "../runner.mjs";

// const iterations = 1000;
const iterations = 100;

const simplePattern = "foo.{js,jsx,ts,tsx}";
const complexPattern = "{a,b,HI{c,e,LMAO{d,f}Q}} wow {a,b}";
const veryComplexPattern = "{a,b,HI{c,e,LMAO{d,f}Q}}{1,2,{3,4},5}";

console.log(braces(complexPattern, { expand: true }));
function benchPattern(pattern, name) {
  const _name = `${name} pattern: "${pattern}"`;
  group({ name: _name, summary: true }, () => {
    if (typeof Bun !== "undefined")
      bench(`Bun (${_name})`, () => {
        for (let i = 0; i < iterations; i++) {
          Bun.$.braces(pattern);
        }
      });

    bench(`micromatch/braces ${_name}`, () => {
      for (let i = 0; i < iterations; i++) {
        braces(pattern, { expand: true });
      }
    });
  });
}

benchPattern(simplePattern, "simple");
benchPattern(complexPattern, "complex");
benchPattern(veryComplexPattern, "very complex pattern");

await run({
  avg: true,
  min_max: true,
  percentiles: true,
});
