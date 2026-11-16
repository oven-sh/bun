import { test, vi, mock, jest } from "bun:test";
import { bump, get } from "made-up-pkg";
vi.mock("made-up-pkg", async original => ({ ...(await original()), get: () => "mock" }));
test("t", async () => { bump(); const real = await vi.importActual("made-up-pkg"); console.log("SAID", real.get(), get()); });
