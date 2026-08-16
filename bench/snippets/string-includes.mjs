import { bench, run } from "../runner.mjs";

const shortStr = "The quick brown fox jumps over the lazy dog";
const longStr = shortStr.repeat(100);

bench("String.includes - short, hit (middle)", () => {
  return shortStr.includes("jumps");
});

bench("String.includes - short, hit (start)", () => {
  return shortStr.includes("The");
});

bench("String.includes - short, hit (end)", () => {
  return shortStr.includes("dog");
});

bench("String.includes - short, miss", () => {
  return shortStr.includes("cat");
});

bench("String.includes - long, hit (middle)", () => {
  return longStr.includes("jumps");
});

bench("String.includes - long, miss", () => {
  return longStr.includes("cat");
});

bench("String.includes - with position", () => {
  return shortStr.includes("fox", 10);
});

await run();
