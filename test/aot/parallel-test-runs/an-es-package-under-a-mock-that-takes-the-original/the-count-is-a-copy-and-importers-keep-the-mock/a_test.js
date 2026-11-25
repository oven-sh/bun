import { test, vi, mock, jest } from "bun:test";
import { count, bump, get } from "made-up-pkg";
vi.mock("made-up-pkg", async original => ({ ...(await original()), get: () => 0 }));
test("t", () => { bump(); console.log("SAID", count, get()); vi.doUnmock("made-up-pkg"); console.log("SAID", get()); });
