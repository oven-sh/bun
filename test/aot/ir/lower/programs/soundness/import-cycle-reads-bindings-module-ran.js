// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.js
// Import cycles: a hoisted function of a module whose body has not run reads its let, const, var, class; live bindings change value and type.
import { early, counter, inc, setText, later, K } from "./a.js";
console.log("main", early, counter, typeof counter);
inc(); console.log(counter); setText(); console.log(counter, typeof counter, counter + 1);
console.log(later(), new K().v);

// FILE: a.js
import { probe } from "./b.js";
export let counter = 0;
export function inc() { counter++; }
export function setText() { counter = "text"; }
export const early = probe;
const secret = { v: 42 };
var hoisted = "set";
export class K { v = secret.v; }
export function peek() { const out = []; for (const f of [() => secret.v, () => hoisted, () => counter, () => new K().v, () => typeof inc]) { try { out.push(String(f())); } catch (e) { out.push(e.name); } } return out.join(); }
export function later() { return peek(); }

// FILE: b.js
import { peek } from "./a.js";
export const probe = peek();

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
