import { test, vi, jest, mock } from "bun:test";
test("b", async () => {
vi.doMock("./m.mjs", () => ({ mName: "Nm", mF: () => "Mm" }));
const p = vi.importActual("./s.mjs");
vi.doMock("./c.mjs", async () => { await 0; return { cName: "Nc", cF: () => "Wc", cHit: () => 8 }; });
const got = await p; console.log("SAID p", Object.keys(got).sort().join(), got.sF?.());
const { other } = await import("./other.mjs"); console.log("SAID b", other());
});
