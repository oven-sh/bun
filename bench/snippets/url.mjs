import { bench, run } from "../runner.mjs";

bench(`new URL('https://example.com/')`, () => {
  const url = new URL("https://example.com/");
});

bench(`new URL('https://example.com')`, () => {
  const url = new URL("https://example.com");
});

bench(`new URL('https://www.example.com')`, () => {
  const url = new URL("https://www.example.com");
});

bench(`new URL('https://www.example.com/')`, () => {
  const url = new URL("https://www.example.com/");
});

await run();
