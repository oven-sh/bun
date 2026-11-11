
          import { expect, test, vi } from "bun:test";
          test("both settle", async () => {
            vi.doMock("./five.cjs", async () => ({ c: "mock, made with " + (await vi.importActual("./two.js")).c }));
            vi.doMock("./three.js", async () => ({ three: "mock, made with " + (await vi.importActual("./three.js")).three }));
            expect({ ...(await import("./three.js")) }).toEqual({ three: "mock, made with 3" });
            expect((await import("./five.cjs")).c).toBe("mock, made with real");
          });
        