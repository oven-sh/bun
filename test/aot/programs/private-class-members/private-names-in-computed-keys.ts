// Every kind of expression with a private name (read, store, call, `in`) inside a computed member key.
declare const console: { log(...a: unknown[]): void };
declare const JSON: { parse(s: string): any };
function said(f: () => unknown): string { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + (e as Error).name; } }
const lines: string[] = [];
const o: any = JSON.parse("{}");
const fn = Object.assign(() => 7, { toString() { return "fn"; } });
let later: [string, (x: any) => unknown][] = [];
let keys = 0;
function both(label: string, f: (x: any) => unknown): string { lines.push(label + ", ahead: " + said(() => f(o))); later.push([label, f]); return "k" + ++keys; }
function afterwards(where: string, C: any) { for (const [label, f] of later) lines.push(where + " " + label + ", behind, of the class: " + said(() => f(C)) + "; of another: " + said(() => f(o))); later = []; }
class Top {
  static #f: any = fn;
  [both("top read", (x: any) => x.#f)]() {}
  [both("top typeof", (x: any) => typeof x.#f)]() {}
  [both("top call", (x: any) => x.#f())]() {}
  [both("top in", (x: any) => #f in x)]() {}
  [both("top compared", (x: any) => x.#f === x.#f)]() {}
  [both("top a template tag", (x: any) => x.#f`t`)]() {}
  [both("top called in parentheses", (x: any) => (x.#f)())]() {}
  [both("top an optional call", (x: any) => x.#f?.())]() {}
  [both("top in an array", (x: any) => [x.#f].length)]() {}
  [both("top an argument", (x: any) => String(x.#f))]() {}
  [both("top spread", (x: any) => [...[x.#f]].length)]() {}
  [both("top a condition", (x: any) => x.#f ? 1 : 2)]() {}
  [both("top negated", (x: any) => !x.#f)]() {}
  [both("top store", (x: any) => x.#f = fn)]() {}
  [both("top add", (x: any) => x.#f += 1)]() {}
  [both("top increment", (x: any) => x.#f++)]() {}
  [both("top decrement ahead", (x: any) => --x.#f)]() {}
  [both("top or", (x: any) => x.#f ||= fn)]() {}
  [both("top and", (x: any) => x.#f &&= fn)]() {}
  [both("top nullish", (x: any) => x.#f ??= fn)]() {}
  [both("top an array pattern", (x: any) => ([x.#f] = [fn]).length)]() {}
  [both("top an object pattern", (x: any) => ({ a: x.#f } = { a: fn }).a === fn)]() {}
  [both("top a pattern with a default", (x: any) => ([x.#f = fn] = []).length)]() {}
  [both("top a rest element", (x: any) => ([...x.#f] = [1]).length)]() {}
  [both("top a for-of head", (x: any) => { for (x.#f of [fn]); return "done"; })]() {}
  [both("top a for-in head", (x: any) => { for (x.#f in { a: 1 }); x.#f = fn; return "done"; })]() {}
}
afterwards("top", Top);
function make() { return class Made {
  static #f: any = fn;
  [both("made read", (x: any) => x.#f)]() {}
  [both("made typeof", (x: any) => typeof x.#f)]() {}
  [both("made call", (x: any) => x.#f())]() {}
  [both("made in", (x: any) => #f in x)]() {}
  [both("made compared", (x: any) => x.#f === x.#f)]() {}
  [both("made a template tag", (x: any) => x.#f`t`)]() {}
  [both("made called in parentheses", (x: any) => (x.#f)())]() {}
  [both("made an optional call", (x: any) => x.#f?.())]() {}
  [both("made in an array", (x: any) => [x.#f].length)]() {}
  [both("made an argument", (x: any) => String(x.#f))]() {}
  [both("made spread", (x: any) => [...[x.#f]].length)]() {}
  [both("made a condition", (x: any) => x.#f ? 1 : 2)]() {}
  [both("made negated", (x: any) => !x.#f)]() {}
  [both("made store", (x: any) => x.#f = fn)]() {}
  [both("made add", (x: any) => x.#f += 1)]() {}
  [both("made increment", (x: any) => x.#f++)]() {}
  [both("made decrement ahead", (x: any) => --x.#f)]() {}
  [both("made or", (x: any) => x.#f ||= fn)]() {}
  [both("made and", (x: any) => x.#f &&= fn)]() {}
  [both("made nullish", (x: any) => x.#f ??= fn)]() {}
  [both("made an array pattern", (x: any) => ([x.#f] = [fn]).length)]() {}
  [both("made an object pattern", (x: any) => ({ a: x.#f } = { a: fn }).a === fn)]() {}
  [both("made a pattern with a default", (x: any) => ([x.#f = fn] = []).length)]() {}
  [both("made a rest element", (x: any) => ([...x.#f] = [1]).length)]() {}
  [both("made a for-of head", (x: any) => { for (x.#f of [fn]); return "done"; })]() {}
  [both("made a for-in head", (x: any) => { for (x.#f in { a: 1 }); x.#f = fn; return "done"; })]() {}
}; }
afterwards("made", make());
afterwards("made again", make());
class Behind {
  [both("name behind read", (x: any) => x.#f)]() {}
  [both("name behind typeof", (x: any) => typeof x.#f)]() {}
  [both("name behind call", (x: any) => x.#f())]() {}
  [both("name behind in", (x: any) => #f in x)]() {}
  [both("name behind compared", (x: any) => x.#f === x.#f)]() {}
  [both("name behind a template tag", (x: any) => x.#f`t`)]() {}
  [both("name behind called in parentheses", (x: any) => (x.#f)())]() {}
  [both("name behind an optional call", (x: any) => x.#f?.())]() {}
  [both("name behind in an array", (x: any) => [x.#f].length)]() {}
  [both("name behind an argument", (x: any) => String(x.#f))]() {}
  [both("name behind spread", (x: any) => [...[x.#f]].length)]() {}
  [both("name behind a condition", (x: any) => x.#f ? 1 : 2)]() {}
  [both("name behind negated", (x: any) => !x.#f)]() {}
  [both("name behind store", (x: any) => x.#f = fn)]() {}
  [both("name behind add", (x: any) => x.#f += 1)]() {}
  [both("name behind increment", (x: any) => x.#f++)]() {}
  [both("name behind decrement ahead", (x: any) => --x.#f)]() {}
  [both("name behind or", (x: any) => x.#f ||= fn)]() {}
  [both("name behind and", (x: any) => x.#f &&= fn)]() {}
  [both("name behind nullish", (x: any) => x.#f ??= fn)]() {}
  [both("name behind an array pattern", (x: any) => ([x.#f] = [fn]).length)]() {}
  [both("name behind an object pattern", (x: any) => ({ a: x.#f } = { a: fn }).a === fn)]() {}
  [both("name behind a pattern with a default", (x: any) => ([x.#f = fn] = []).length)]() {}
  [both("name behind a rest element", (x: any) => ([...x.#f] = [1]).length)]() {}
  [both("name behind a for-of head", (x: any) => { for (x.#f of [fn]); return "done"; })]() {}
  [both("name behind a for-in head", (x: any) => { for (x.#f in { a: 1 }); x.#f = fn; return "done"; })]() {}
  static #f: any = fn;
}
afterwards("name behind", Behind);
for (const line of lines) console.log(line);
