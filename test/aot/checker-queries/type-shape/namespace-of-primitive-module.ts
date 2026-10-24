// `import * as all` of a module whose value is a primitive: what runs has a namespace object with `default`, so that is its type.
import * as all from "./namespace-of-primitive-module-value.js";
import text from "./namespace-of-primitive-module-value.js";
let v1: typeof all;
let v2: typeof all.default;
let v3: typeof text;
