import braces from "braces";
import { bench, run } from "mitata";

const pattern = "{a,b,HI{c,e,LMAO{d,f}Q}}";
bench("Bun.braces", () => {
  for (let i = 0; i < 1000; i++) {
    Bun.braces(pattern);
  }
});

bench("braces", () => {
  for (let i = 0; i < 1000; i++) {
    braces(pattern, { expand: true });
  }
});

await run({
  avg: true,
  min_max: true,
  percentiles: true,
});
