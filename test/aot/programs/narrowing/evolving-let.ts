// `let x;` without a type or an initializer in a TypeScript file holds whatever is assigned to it.
function ends(text: string) { let end; let count = 0; for (let i = 0; i < text.length; i++) { if (text.charCodeAt(i) === 32) { end = i; count++ } } return end === undefined ? -1 : end * 10 + count }
function label(n: number) { let s; if (n > 0) s = "above"; else if (n < 0) s = "below"; return s ?? "zero" }
function mixed(n: number) { let v; v = n > 1 ? n : "one"; return typeof v === "number" ? v + 1 : v + "!" }
function counted(n: number) { let k; k = 0; while (k < n) { k++; k += 2 } return k }
function list(n: number) { let a; a = []; for (let i = 0; i < n; i++) a.push(i * 2); return a.length + (a[1] ?? 0) }
function untyped(o: any) { let v; v = o.x; return v }
function taken(p: number[]) { let x; [x] = p; return x }
const n = Number("4")
console.log(ends("a b c"), ends("abc"), label(n), label(-n), label(0), mixed(n), mixed(1), counted(n * 2))
console.log(list(n), untyped({ x: "y" }), untyped({}), taken([n, 1]))
