import { test, vi, mock, jest } from "bun:test";
import { get } from "made-up-pkg";
vi.mock("made-up-pkg", async original => ({ ...(await original()), get: () => "one" }));
test("t", async () => { console.log("SAID", get()); vi.doUnmock("made-up-pkg"); vi.doMock("made-up-pkg", () => ({ get: () => "two" })); console.log("SAID", (await import("made-up-pkg")).get()); vi.doUnmock("made-up-pkg"); console.log("SAID", (await import("made-up-pkg")).get(), get()); });
