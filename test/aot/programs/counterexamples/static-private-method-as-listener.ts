// A static private method that was added to a Set can be deleted from it.
declare const console: { log(...a: unknown[]): void };
function f(log: string[]) {
  class C { static #heard() { log.push("fired"); } static go(s: Set<() => void>) { s.add(C.#heard); s.delete(C.#heard); } }
  const s = new Set<() => void>(); C.go(s); for (const h of s) h();
  return "still listening: " + s.size + " [" + log.join() + "]";
}
console.log(f([]));
