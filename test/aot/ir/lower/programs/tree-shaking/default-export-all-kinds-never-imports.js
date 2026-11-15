// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 14

// FILE: main.js
// Each file has a default export and a named one; only the named one is imported. The default is a literal, an object, an array, a name, a function, a class, an arrow function, a call, a marked call, a conditional, a template, a `new`. Those that do something do it. `bun run` also makes the marked call; `bun build --compile` does not.
import { log } from "./log.js";
import { named as a } from "./kinds/literal.js";
import { named as b } from "./kinds/object.js";
import { named as c } from "./kinds/name.js";
import { named as d } from "./kinds/function.js";
import { named as e } from "./kinds/class.js";
import { named as f } from "./kinds/arrow.js";
import { named as g } from "./kinds/call.js";
import { named as h } from "./kinds/marked-call.js";
import { named as i } from "./kinds/conditional.js";
import { named as j } from "./kinds/new.js";
import { named as k } from "./kinds/class-with-static.js";
import { named as l } from "./kinds/object-with-call.js";

console.log([a, b, c, d, e, f, g, h, i, j, k, l].join(""));
console.log(log.join("\n"));

// FILE: kinds/arrow.js
export const named = "f";
export default () => "never";

// FILE: kinds/call.js
import { effect } from "../log.js";
export const named = "g";
export default effect("a call");

// FILE: kinds/class-with-static.js
import { effect } from "../log.js";
export const named = "k";
export default class { static field = effect("a static field"); }

// FILE: kinds/class.js
export const named = "e";
export default class { method() { return "never"; } }

// FILE: kinds/conditional.js
import { effect, log } from "../log.js";
export const named = "i";
export default log.length >= 0 ? effect("an arm of a conditional") : 0;

// FILE: kinds/function.js
export const named = "d";
export default function () { return "never"; }

// FILE: kinds/literal.js
export const named = "a";
export default 5;

// FILE: kinds/marked-call.js
import { effect } from "../log.js";
export const named = "h";
export default /* @__PURE__ */ effect("a marked call");

// FILE: kinds/name.js
export const named = "c";
const local = { only: "the default names this" };
export default local;

// FILE: kinds/new.js
import { effect } from "../log.js";
export const named = "j";
export default new (class { constructor() { effect("a constructor"); } })();

// FILE: kinds/object-with-call.js
import { effect } from "../log.js";
export const named = "l";
export default { value: effect("a call inside an object") };

// FILE: kinds/object.js
export const named = "b";
export default { a: 1, list: [1, 2], nested: { deep: true } };

// FILE: log.js
export const log = [];
export const effect = name => { log.push(name); return name; };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
