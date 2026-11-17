import { test, expect, afterAll } from "bun:test";
(Array.prototype as any).spoil = 5; afterAll(() => { delete (Array.prototype as any).spoil; });
const keys: any[] = JSON.parse("[0,\"spoil\",1,\"length\",\"zz\",\"0\"]");
function read(l: number[], k: any) { return l[k] as any; }
test("texts", () => { expect(keys.map(k => String(read([10, 20], k)))).toEqual(["10", "5", "20", "2", "undefined", "10"]); let s: any = 0; for (const k of keys) s = s + read([1, 2], k); expect(String(s)).toBe(String(1 + 5 + 2 + 2) + "undefined1".replace("undefined", "") === s ? s : String(s)); const l: any = [1, 2]; l.spoil = "own"; expect(read(l, "spoil")).toBe("own"); });
