import { test, vi, mock, jest } from "bun:test";
vi.mock("made-up-pkg");
test("t", async () => { const mocked = await import("made-up-pkg"); console.log("SAID", typeof mocked.get, String(mocked.get())); vi.doUnmock("made-up-pkg"); const real = await import("made-up-pkg"); console.log("SAID", real.get()); });
