// The loader reads every own enumerable property of what a CommonJS module exports when an ES module imports it, by a declaration or by a call: getters run, whichever names the importer uses.
import { a, b } from "./getters.cjs";
import * as star from "./passes-on.mjs";
import * as computed from "./functions.cjs";
import callable, { helper } from "./callable.cjs";
import marked, { named } from "./marked.cjs";
import { inner } from "./as-namespace.mjs";
import styles, { red } from "./accessor-for-exports.cjs";
import * as trapped from "./proxy.cjs";
function show(...parts) { let text = ""; for (let i = 0; i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); console.log(text); }
show("1", a, typeof b, globalThis.gettersLog.join());
show("2", Object.keys(star).join(), typeof star.a, star.own, globalThis.passedOnLog.join());
for (const name of ["f", "g"]) show("3", name, computed[name]("x"));
for (const key in computed) show("4", key, typeof computed[key]);
show("5", callable(1), helper("s"), callable.helper === helper);
show("6", typeof marked, marked && marked.k, named);
show("7", typeof inner.f, inner.f("s"), Object.keys(inner).join());
show("8", typeof styles, styles.red.open, red.close, globalThis.assembled);
show("9", globalThis.trapLog.join(), typeof trapped.a);
await import("./only-for-its-effects.cjs");
show("10", globalThis.effects.join());
const { default: library } = await import("./default-only.cjs");
show("11", library.used(), globalThis.defaultOnlyLog.join());
const all = await Promise.all([import("./first-of-two.cjs"), import("./second-of-two.cjs")]);
show("12", all.length, globalThis.twoLog.sort().join());
