import { test } from "bun:test";
test("the run is still asked which names it leaves alone", () => {
  console.log("SAID", typeof expect, expect === globalThis.expect, typeof describe, describe === globalThis.describe);
  console.log("SAID", typeof [import.meta.path].map(Bun.jest)[0]);
});
