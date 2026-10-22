// A `number | string` variable is assigned by a destructuring pattern with a default, from data whose type annotation is wrong. The pattern reads an element of a written `[number]`, so a string there throws a TypeError; a number passes, and a missing element takes the default.
declare const console: { log(...all: unknown[]): void };
function give(): [number] { return (globalThis as any).given; }
function t() { let x: number | string = "t"; [x = 2] = give(); const y = x; return [typeof y, y + 1].join(" | "); }
for (const v of [[5], ["abc"], []]) { (globalThis as any).given = v; try { console.log(t()); } catch (e: any) { console.log("threw " + e.name); } }
