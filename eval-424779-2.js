process.argv.splice(1, 1);
          import { expect } from "bun:test";
          const getter = Object.defineProperty([], 0, { get: () => "x", enumerable: true });
          for (const matcher of [expect.stringContaining("a"), expect.any(String), expect.arrayContaining([1])]) {
            try { expect([,]).toEqual([matcher]); } catch {}
            try { expect([]).toEqual(expect.arrayContaining([[matcher]])); } catch {}
            try { expect(getter).toEqual([matcher]); } catch {}
            try { expect({ a: [["x"]] }).toMatchObject({ a: expect.arrayContaining([["x", matcher]]) }); } catch {}
          }
          console.log("ok");
        