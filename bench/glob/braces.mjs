import braces from "braces";
import { bench, group, run } from "../runner.mjs";

// const iterations = 1000;
const iterations = 100;

const simplePattern = "foo.{js,jsx,ts,tsx}";
const complexPattern = "{a,b,HI{c,e,LMAO{d,f}Q}} wow {a,b}";
const veryComplexPattern = "{a,b,HI{c,e,LMAO{d,f}Q}}{1,2,{3,4},5}";
const oneBytePattern = "{a,b,c,d,e,f,g,h}";
const nonAsciiPattern = "café-{résumé,naïve,déjà}.txt";

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
benchPattern(oneBytePattern, "one-byte alternatives");
benchPattern(nonAsciiPattern, "non-ASCII");

await run({
  avg: true,
  min_max: true,
  percentiles: true,
});
