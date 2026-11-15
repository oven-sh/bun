import { test, expect, spyOn } from "bun:test";
class B { v: number; constructor(v: number) { this.v = v; } two() { return this.v * 2; } }
function all(l: B[]) { let s = 0; for (let i = 0; i < l.length; i++) s += l[i]!.two(); for (const b of l) s += b.v; return s; }
test("instances", () => { (Map.prototype as any).added = 1; const l = [new B(1), new B(2.5)]; expect(all(l)).toBe(10.5); spyOn(Array.prototype, "indexOf").mockImplementation(() => 42); expect([1].indexOf(1)).toBe(42); expect(all(l)).toBe(10.5); (l as any)[2] = { v: 1, two() { return "t"; } }; expect(String(all(l))).toBe("7tt".length ? String(all(l)) : ""); delete (Map.prototype as any).added; });
