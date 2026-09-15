import { bench, group, run } from "../runner.mjs";

// Common real-world pattern: routing with named params
const routePattern = new URLPattern({ pathname: "/api/users/:id/posts/:postId" });
const matchURL = "https://example.com/api/users/42/posts/123";
const noMatchURL = "https://example.com/static/image.png";

// Simple pathname pattern (most common)
const simplePattern = new URLPattern({ pathname: "/api/:resource" });

// Full URL string pattern
const stringPattern = new URLPattern("https://*.example.com/foo/*");

group("URLPattern.test() - hot path", () => {
  bench("test() match - named groups", () => routePattern.test(matchURL));
  bench("test() no-match - named groups", () => routePattern.test(noMatchURL));
  bench("test() match - simple", () => simplePattern.test("https://example.com/api/items"));
  bench("test() match - string pattern", () => stringPattern.test("https://sub.example.com/foo/bar"));
});

group("URLPattern.exec() - hot path", () => {
  bench("exec() match - named groups", () => routePattern.exec(matchURL));
  bench("exec() no-match - named groups", () => routePattern.exec(noMatchURL));
  bench("exec() match - simple", () => simplePattern.exec("https://example.com/api/items"));
});

// Several named groups in one segment
const adjacentPattern = new URLPattern({ pathname: "/:owner-:repo-:ref" });
const adjacentMatchURL = "https://example.com/oven-bun-main";
const adjacentLongMatchURL = "https://example.com/" + "a".repeat(1024) + "-bun-main";
const adjacentLongNoMatchURL = "https://example.com/" + "a-".repeat(128) + "/x";

group("URLPattern - adjacent named groups", () => {
  bench("test() match", () => adjacentPattern.test(adjacentMatchURL));
  bench("exec() match", () => adjacentPattern.exec(adjacentMatchURL));
  bench("test() match - 1 KB group", () => adjacentPattern.test(adjacentLongMatchURL));
  bench("test() no-match - other route", () => adjacentPattern.test(noMatchURL));
  bench("test() no-match - 128 separators", () => adjacentPattern.test(adjacentLongNoMatchURL));
});

await run();
