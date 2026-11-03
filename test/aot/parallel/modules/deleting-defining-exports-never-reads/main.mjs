// Each module here has exports that nothing reads. A namespace object refuses to delete an export, accepts a definition that changes nothing, and refuses every other one, however the program got hold of it.
import sloppy from "./sloppy.cjs";
import strict from "./strict.cjs";
import * as imported from "./imported-as-a-namespace.mjs";
import * as boxed from "./held-in-a-box.mjs";
import * as computed from "./asked-under-a-computed-key.mjs";
import * as fields from "./given-to-class-fields.mjs";
import * as many from "./given-to-defineproperties.mjs";
import * as indexed from "./exports-under-indexes.mjs";

const attempt = f => {
  try {
    return String(f());
  } catch (e) {
    return e.constructor.name;
  }
};
/** @param {any} t */
function ask(t) {
  return [
    attempt(() => delete t.a1),
    attempt(() => delete t["a2"]),
    attempt(() => Reflect.deleteProperty(t, "a3")),
    attempt(() => Reflect.defineProperty(t, "a4", {})),
    attempt(() => Reflect.defineProperty(t, "a5", { value: 5 })),
    attempt(() => Reflect.defineProperty(t, "a6", { value: 7 })),
    attempt(() => Object.defineProperty(t, "a7", { value: 7 }) === t),
    attempt(() => delete t.missing),
    attempt(() => Reflect.deleteProperty(t, "missing")),
    attempt(() => Reflect.defineProperty(t, "missing", {})),
    attempt(() => Reflect.deleteProperty(t, Symbol.toStringTag)),
    attempt(() => t.used()),
  ].join(" ");
}

console.log("required by sloppy code:", sloppy.ask());
console.log("required by strict code:", strict.ask());
console.log("imported as a namespace:", ask(imported));
console.log("imported by a call:", ask(await import("./imported-by-a-call.mjs")));

const box = { held: boxed };
console.log(
  "held in a box:",
  attempt(() => Reflect.deleteProperty(box[["he", "ld"].join("")], "a3")),
);

/** @type {any} */
const anyComputed = computed;
const key = ["a", "3"].join("");
console.log(
  "under a computed key:",
  attempt(() => Reflect.deleteProperty(anyComputed, key)),
  attempt(() => delete anyComputed[key]),
  attempt(() => Reflect.defineProperty(anyComputed, key, { value: 3 })),
);

class Returns {
  constructor(value) {
    return value;
  }
}
class DefinesTheSameValue extends Returns {
  a5 = 5;
}
class DefinesAnotherValue extends Returns {
  a6 = 7;
}
class DefinesANewName extends Returns {
  missing = 1;
}
console.log(
  "class fields:",
  attempt(() => new DefinesTheSameValue(fields) === fields),
  attempt(() => new DefinesAnotherValue(fields) === fields),
  attempt(() => new DefinesANewName(fields) === fields),
);

/** @type {any} */
const anyMany = many;
console.log(
  "Object.defineProperties:",
  attempt(() => Object.defineProperties(anyMany, { a3: { value: 3 }, a4: {} }) === anyMany),
  attempt(() => Object.defineProperties(anyMany, { a5: { value: 6 } }) === anyMany),
  attempt(() => Object.defineProperties(anyMany, { missing: {} }) === anyMany),
);

/** @type {any} */
const anyIndexed = indexed;
console.log(
  "exports under indexes:",
  attempt(() => delete anyIndexed[0]),
  attempt(() => Reflect.deleteProperty(anyIndexed, "1")),
  attempt(() => Reflect.defineProperty(anyIndexed, 2, {})),
  attempt(() => Reflect.defineProperty(anyIndexed, "3", { value: "three" })),
  attempt(() => delete anyIndexed[4]),
  attempt(() => Reflect.deleteProperty(anyIndexed, "named")),
);
