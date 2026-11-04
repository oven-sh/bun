import { test, vi } from "bun:test";
import { viaEarly } from "./early";
import { viaLate } from "./late";
import * as lib from "./lib";

// The preload has mocked lib and has loaded early.ts under that mock. The mock of this file reaches what this file was the first to load.
test("a second mock leaves the mock of the preload to whoever the preload linked to it", () => {
  vi.mock("./lib", () => ({ who: "file" }));
  console.log("seen:", lib.who, viaLate(), viaEarly(), (globalThis as any).heldByPreload());
});
