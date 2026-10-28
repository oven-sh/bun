// `Array.prototype.sort` with a comparator that writes to, freezes or resizes the array.
declare const console: { log(...a: unknown[]): void };
function said(f: any) { try { return String(f()); } catch (e) { return "threw " + (e as any).name; } }
function row(label: any, f: any) { console.log(label + ": " + said(f)); }
const show = (a: any) => JSON.stringify(a) + " " + a.length;
const up = (x: any, y: any) => x - y;
row("row 103", () => { const a: any = [1, 2]; return a.sort((x: any, y: any) => (a[0] = 9, x - y)).join(); });
row("row 104", () => { const a: any = [1, 2]; a.sort((x: any, y: any) => (Object.freeze(a), x - y)); return show(a); });
row("doubles, a store, in order", () => { const a: any = [1.5, 2.5, 3.5]; a.sort((x: any, y: any) => (a[1] = 9.5, x - y)); return show(a); });
row("doubles, a store, out of order", () => { const a: any = [3.5, 1.5, 2.5]; a.sort((x: any, y: any) => (a[1] = 9.5, x - y)); return show(a); });
row("objects, a store, in order", () => { const a: any = [{ v: 1 }, { v: 2 }]; a.sort((x: any, y: any) => (a[0] = { v: 9 }, x.v - y.v)); return show(a); });
row("strings, a store, in order", () => { const a: any = ["a", "b", "c"]; a.sort((x: any, y: any) => (a[2] = "z", x < y ? -1 : 1)); return show(a); });
row("frozen ahead, in order", () => { const a: any = Object.freeze([1, 2]); a.sort(up); return show(a); });
row("frozen ahead, out of order", () => { const a: any = Object.freeze([2, 1]); a.sort(up); return show(a); });
row("frozen ahead, one element", () => { const a: any = Object.freeze([1]); a.sort(up); return show(a); });
row("frozen ahead, empty", () => { const a: any = Object.freeze([]); a.sort(up); return show(a); });
row("frozen ahead, doubles", () => { const a: any = Object.freeze([1.5, 2.5]); a.sort(up); return show(a); });
row("sealed, in order", () => { const a: any = Object.seal([1, 2]); a.sort(up); return show(a); });
row("not extensible, in order", () => { const a: any = Object.preventExtensions([1, 2]); a.sort(up); return show(a); });
row("one element read-only, in order", () => { const a: any = [1, 2, 3]; Object.defineProperty(a, 1, { value: 2, writable: false }); a.sort(up); return show(a); });
row("the length cut to nothing", () => { const a: any = [1, 2, 3]; a.sort((x: any, y: any) => (a.length = 0, x - y)); return show(a); });
row("the length cut to one", () => { const a: any = [3, 1, 2]; a.sort((x: any, y: any) => (a.length = 1, x - y)); return show(a); });
row("a push", () => { const a: any = [1, 2]; let once = true; a.sort((x: any, y: any) => (once && (once = false, a.push(0)), x - y)); return show(a); });
row("a pop", () => { const a: any = [1, 2, 3]; let once = true; a.sort((x: any, y: any) => (once && (once = false, a.pop()), x - y)); return show(a); });
row("a delete", () => { const a: any = [1, 2, 3]; a.sort((x: any, y: any) => (delete a[1], x - y)); return show(a) + " " + (1 in a); });
row("another kind of element", () => { const a: any = [1, 2, 3]; a.sort((x: any, y: any) => (a[0] = "s", x - y)); return show(a); });
row("doubles made objects", () => { const a: any = [1.5, 2.5]; a.sort((x: any, y: any) => (a[0] = {}, x - y)); return show(a); });
row("a hole, in order", () => { const a: any = [1, , 2]; a.sort(up); return show(a) + " " + (2 in a); });
row("a hole, a store into it", () => { const a: any = [1, , 2]; a.sort((x: any, y: any) => (a[1] = 7, x - y)); return show(a) + " " + (2 in a); });
row("undefined among them, in order", () => { const a: any = [1, undefined, 2]; a.sort(up); return show(a); });
row("undefined at the end, a store", () => { const a: any = [1, 2, undefined]; a.sort((x: any, y: any) => (a[2] = 5, x - y)); return show(a); });
row("the comparator throws", () => { const a: any = [2, 1, 3]; try { a.sort(() => { a[0] = 9; throw new Error("x"); }); } catch {} return show(a); });
row("twenty, in order, a store", () => { const a: any = Array.from({ length: 20 }, (_, i) => i); a.sort((x: any, y: any) => (a[19] = -1, x - y)); return a.join(); });
row("twenty, reversed, a store", () => { const a: any = Array.from({ length: 20 }, (_, i) => 20 - i); a.sort((x: any, y: any) => (a[0] = -1, x - y)); return a.join(); });
row("control: in order", () => show([1, 2, 3].sort(up)));
row("control: out of order", () => show([3, 1, 2].sort(up)));
row("control: the same array comes back", () => { const a: any = [1, 2]; return a.sort(up) === a; });
row("control: stable", () => [{ k: 1, v: "a" }, { k: 1, v: "b" }, { k: 0, v: "c" }].sort((x, y) => x.k - y.k).map((o) => o.v).join());
row("control: toSorted leaves it", () => { const a: any = [1, 2]; const b = a.toSorted((x: any, y: any) => (a[0] = 9, x - y)); return show(a) + " " + show(b); });
