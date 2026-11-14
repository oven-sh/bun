import { test, vi, jest, mock } from "bun:test";
test("b", async () => {
  const one = await import("./one.mjs"), two = await import("./two.mjs");
  console.log("SAID b", one.seen(), "|", two.seen(), "|", one.held() === two.held());
});
