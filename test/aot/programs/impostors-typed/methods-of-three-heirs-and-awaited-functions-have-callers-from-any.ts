// Methods called through the class of the receiver, and async functions that are awaited at once, are handed values of other types than they declare.
const strangers: any[] = ["s", null, undefined, { a: 1 }, 1.5, true, 10n, [1], -0, NaN];
function show(value: unknown): string { try { return typeof value + ":" + String(value); } catch (error) { return "throws " + (error as Error).constructor.name; } }
async function twice(v: number): Promise<number> { await null; return v + v; }
async function size(v: string): Promise<number> { await null; return v.length; }
async function viaAwait(v: number, t: string) { const a = await twice(v); const b = await size(t); return show(a) + " " + show(b); }
abstract class Shape { abstract area(k: number): number; abstract name(s: string): number; }
class Square extends Shape { constructor(public w: number) { super(); } area(k: number) { return this.w * k; } name(s: string) { return s.length + 1; } }
class Round extends Shape { constructor(public r: number) { super(); } area(k: number) { return this.r + k; } name(s: string) { return s.length + 2; } }
class Flat extends Shape { area(k: number) { return k | 0; } name(s: string) { return s.charCodeAt(0); } }
const shapes: Shape[] = [new Square(2), new Round(3), new Flat()];
function viaTable(shape: Shape, k: number, s: string) { let out = ""; try { out += show(shape.area(k)); } catch (e) { out += "throws " + (e as Error).constructor.name; } try { out += " " + show(shape.name(s)); } catch (e) { out += " throws " + (e as Error).constructor.name; } return out; }
for (let warm = 0; warm < 300; warm++) viaTable(shapes[warm % 3], warm, "w" + warm);
for (let i = 0; i < strangers.length; i++) for (const shape of shapes) console.log(i, shape.constructor.name, viaTable(shape, strangers[i], strangers[i]));
for (let i = 0; i < strangers.length; i++) { try { console.log(i, await viaAwait(strangers[i], strangers[i])); } catch (e) { console.log(i, "throws", (e as Error).constructor.name); } }
export {};
