import { test, vi, jest, mock } from "bun:test";
test("b", async () => {
jest.doMock("./s.mjs", async () => ({ ...(await import("./s.mjs")), sF: () => "Ms" }));
(0, vi.mock)("./m.mjs", async () => { await 0; return { mName: "Nm", mF: () => "Wm", mHit: () => 8 }; });
(0, vi.mock)("./c.mjs", async original => ({ ...(await original()), cF: () => "Mc" }));
const p = vi.importActual("./s.mjs");
const got = await p; console.log("SAID p", Object.keys(got).sort().join(), got.sF?.());
const { other } = await import("./other.mjs"); console.log("SAID b", other());
vi.doUnmock("./s.mjs"); console.log("SAID b2", (await import("./other.mjs")).other());
});
