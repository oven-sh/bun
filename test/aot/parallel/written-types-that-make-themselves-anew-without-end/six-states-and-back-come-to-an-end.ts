type After = { a: "b"; b: "c"; c: "d"; d: "e"; e: "f"; f: "a" };
type Step<K extends keyof After> = { at: K; next?: Step<After[K]> };
const first: Step<"a"> = { at: "a", next: { at: "b", next: { at: "c", next: { at: "d", next: { at: "e", next: { at: "f", next: { at: "a" } } } } } } };
console.log(first.at, first.next?.at, first.next?.next?.next?.next?.next?.next?.at);
export {};
