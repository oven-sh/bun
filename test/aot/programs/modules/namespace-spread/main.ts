// `{ ...namespace }`, Object.assign and rest patterns over module namespace objects: the names in their order, live values at the moment of the copy, re-exports, a default, and a binding that is still in its dead zone.
import * as plain from "./plain";
import * as barrel from "./barrel";
import * as early from "./early";
const show = (value: unknown) => JSON.stringify(value, (key, held) => typeof held === "function" ? "function " + held.name : held === undefined ? "undefined" : held);
console.log(show({ ...plain }), Object.keys({ ...plain }).join());
console.log(show({ first: 1, ...plain, zeta: "overridden" }), show({ ...plain, ...barrel }));
plain.bump(); plain.bump();
console.log(show({ ...plain }.counter), show(Object.assign({}, plain).counter), show(Object.assign({ counter: -1 }, barrel)));
const { alpha, ...others } = plain as Record<string, unknown>;
console.log(show(alpha), show(others));
const copy = { ...plain } as Record<string, unknown>;
console.log(Object.getPrototypeOf(copy) === Object.prototype, Object.isExtensible(copy), show(Object.getOwnPropertyDescriptor(copy, "alpha")), Symbol.toStringTag in copy, copy === (plain as unknown));
copy.alpha = "changed"; console.log(plain.alpha, show(copy.alpha));
console.log(show(early.seen));
let sum = 0; for (let i = 0; i < 20000; i++) { plain.bump(); sum += ({ ...plain } as { counter: number }).counter; } console.log(sum);
