import { test } from "bun:test";

test("imports the tower and its lamp", async () => {
  const { shines } = await import("./tower.mjs");
  console.log("second:", shines());
  const lamp = await import("./lamp.cjs");
  console.log("second:", lamp.color, lamp.height);
});
