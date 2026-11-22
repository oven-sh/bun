// As ../the-mock-ends, by vi.mock() and statements.
import { test, vi, mock } from "bun:test";
import { p } from "made-up-pkg";
import { x } from "made-up-dep";
vi.mock("made-up-dep", () => ({ x: "mock" }));
test("x", async () => { console.log("SAID under", x, p()); vi.doUnmock("made-up-dep"); console.log("SAID ended", x, p(), (await import("made-up-dep")).x); });
