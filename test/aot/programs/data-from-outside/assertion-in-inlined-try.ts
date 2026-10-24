// `s + 1` where `s` is declared a string and holds null or undefined is a number, as in plain Bun, also inside an inlined `try` block.
const hide = (v: unknown): any => v;
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
attempt("null as string, + 1", () => { const s: string = hide(null); return s + 1 })
attempt("undefined as string, + 1", () => { const s: string = hide(undefined); return s + 1 })
console.log("after");
export {};
