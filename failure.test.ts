import { afterAll, describe, expect, test, afterEach } from "bun:test";

// test("abc", () => {});
for (let i = 0; i < 1000; i++) {
  for (let i = 0; i < 1000; i++) {
    test.skip;
  }
  Bun.gc(true);
  console.log("RSS:", process.memoryUsage().rss);
}
