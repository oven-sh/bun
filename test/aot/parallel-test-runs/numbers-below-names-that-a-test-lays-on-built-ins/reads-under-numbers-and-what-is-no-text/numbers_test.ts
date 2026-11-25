import { test, expect, afterAll } from "bun:test";
(Array.prototype as any).spoil = function () { return "spoiled"; }; (Object.prototype as any).laid = 7;
afterAll(() => { delete (Array.prototype as any).spoil; delete (Object.prototype as any).laid; });
function sum(l: number[]) { let s = 0; for (let i = 0; i < l.length; i++) s += l[i]!; return s; }
function at(l: any[], i: any) { return l[i]; }
test("numbers", () => { expect(sum([1.5, 2, 3])).toBe(6.5); expect(sum([1, , 3] as any)).toBeNaN(); for (const i of [0, 1, 2, 3, -1, 0.5, NaN, undefined, null, true, false]) expect(String(at([1, 2.5, "x"], i))).toBe(i === 0 ? "1" : i === 1 ? "2.5" : i === 2 ? "x" : "undefined"); expect("abc"[1]).toBe("b"); expect(("abc" as any)[7]).toBeUndefined(); });
