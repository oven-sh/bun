// Declarations: sort with a comparator that touches the array (the same program without type annotations).
function said(f) { try { return String(f()); } catch (e) { return "threw " + (e).name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
const show = (a) => JSON.stringify(a) + " " + a.length;
const up = (x, y) => x - y;
row("row 103", () => { const a = [1, 2]; return a.sort((x, y) => (a[0] = 9, x - y)).join(); });
row("row 104", () => { const a = [1, 2]; a.sort((x, y) => (Object.freeze(a), x - y)); return show(a); });
row("doubles, a store, in order", () => { const a = [1.5, 2.5, 3.5]; a.sort((x, y) => (a[1] = 9.5, x - y)); return show(a); });
row("doubles, a store, out of order", () => { const a = [3.5, 1.5, 2.5]; a.sort((x, y) => (a[1] = 9.5, x - y)); return show(a); });
row("objects, a store, in order", () => { const a = [{ v: 1 }, { v: 2 }]; a.sort((x, y) => (a[0] = { v: 9 }, x.v - y.v)); return show(a); });
row("strings, a store, in order", () => { const a = ["a", "b", "c"]; a.sort((x, y) => (a[2] = "z", x < y ? -1 : 1)); return show(a); });
row("frozen ahead, in order", () => { const a = Object.freeze([1, 2]); a.sort(up); return show(a); });
row("frozen ahead, out of order", () => { const a = Object.freeze([2, 1]); a.sort(up); return show(a); });
row("frozen ahead, one element", () => { const a = Object.freeze([1]); a.sort(up); return show(a); });
row("frozen ahead, empty", () => { const a = Object.freeze([]); a.sort(up); return show(a); });
row("frozen ahead, doubles", () => { const a = Object.freeze([1.5, 2.5]); a.sort(up); return show(a); });
row("sealed, in order", () => { const a = Object.seal([1, 2]); a.sort(up); return show(a); });
row("not extensible, in order", () => { const a = Object.preventExtensions([1, 2]); a.sort(up); return show(a); });
row("one element read-only, in order", () => { const a = [1, 2, 3]; Object.defineProperty(a, 1, { value: 2, writable: false }); a.sort(up); return show(a); });
row("the length cut to nothing", () => { const a = [1, 2, 3]; a.sort((x, y) => (a.length = 0, x - y)); return show(a); });
row("the length cut to one", () => { const a = [3, 1, 2]; a.sort((x, y) => (a.length = 1, x - y)); return show(a); });
row("a push", () => { const a = [1, 2]; let once = true; a.sort((x, y) => (once && (once = false, a.push(0)), x - y)); return show(a); });
row("a pop", () => { const a = [1, 2, 3]; let once = true; a.sort((x, y) => (once && (once = false, a.pop()), x - y)); return show(a); });
row("a delete", () => { const a = [1, 2, 3]; a.sort((x, y) => (delete a[1], x - y)); return show(a) + " " + (1 in a); });
row("another kind of element", () => { const a = [1, 2, 3]; a.sort((x, y) => (a[0] = "s", x - y)); return show(a); });
row("doubles made objects", () => { const a = [1.5, 2.5]; a.sort((x, y) => (a[0] = {}, x - y)); return show(a); });
row("a hole, in order", () => { const a = [1, , 2]; a.sort(up); return show(a) + " " + (2 in a); });
row("a hole, a store into it", () => { const a = [1, , 2]; a.sort((x, y) => (a[1] = 7, x - y)); return show(a) + " " + (2 in a); });
row("undefined among them, in order", () => { const a = [1, undefined, 2]; a.sort(up); return show(a); });
row("undefined at the end, a store", () => { const a = [1, 2, undefined]; a.sort((x, y) => (a[2] = 5, x - y)); return show(a); });
row("the comparator throws", () => { const a = [2, 1, 3]; try { a.sort(() => { a[0] = 9; throw new Error("x"); }); } catch {} return show(a); });
row("twenty, in order, a store", () => { const a = Array.from({ length: 20 }, (_, i) => i); a.sort((x, y) => (a[19] = -1, x - y)); return a.join(); });
row("twenty, reversed, a store", () => { const a = Array.from({ length: 20 }, (_, i) => 20 - i); a.sort((x, y) => (a[0] = -1, x - y)); return a.join(); });
row("control: in order", () => show([1, 2, 3].sort(up)));
row("control: out of order", () => show([3, 1, 2].sort(up)));
row("control: the same array comes back", () => { const a = [1, 2]; return a.sort(up) === a; });
row("control: stable", () => [{ k: 1, v: "a" }, { k: 1, v: "b" }, { k: 0, v: "c" }].sort((x, y) => x.k - y.k).map((o) => o.v).join());
row("control: toSorted leaves it", () => { const a = [1, 2]; const b = a.toSorted((x, y) => (a[0] = 9, x - y)); return show(a) + " " + show(b); });
