import { bench, group, run } from "../runner.mjs";

const patterns = [
  { name: "string pattern", input: "https://(sub.)?example(.com/)foo" },
  { name: "hostname IDN", input: { hostname: "xn--caf-dma.com" } },
  {
    name: "pathname + search + hash + baseURL",
    input: {
      pathname: "/foo",
      search: "bar",
      hash: "baz",
      baseURL: "https://example.com:8080",
    },
  },
  { name: "pathname with regex", input: { pathname: "/([[a-z]--a])" } },
  { name: "named groups", input: { pathname: "/users/:id/posts/:postId" } },
  { name: "wildcard", input: { pathname: "/files/*" } },
];

const testURL = "https://sub.example.com/foo";

group("URLPattern parse (constructor)", () => {
  for (const { name, input } of patterns) {
    bench(name, () => {
      return new URLPattern(input);
    });
  }
});

group("URLPattern.test()", () => {
  for (const { name, input } of patterns) {
    const pattern = new URLPattern(input);
    bench(name, () => {
      return pattern.test(testURL);
    });
  }
});

group("URLPattern.exec()", () => {
  for (const { name, input } of patterns) {
    const pattern = new URLPattern(input);
    bench(name, () => {
      return pattern.exec(testURL);
    });
  }
});

await run();
