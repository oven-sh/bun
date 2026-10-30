// Each module here has exports that nothing reads. A class field and a store through super define a property on their receiver. A namespace object accepts the definition that changes nothing and refuses every other one.
import sloppy from "./sloppy.cjs";
import * as named from "./given-to-named-fields.mjs";
import * as computed from "./given-to-computed-fields.mjs";
import * as late from "./given-to-fields-under-keys-made-at-run-time.mjs";
import * as stored from "./stored-through-super.mjs";
import * as storedUnderKeys from "./stored-through-super-under-keys.mjs";
import * as storedBySloppyCode from "./stored-through-super-by-sloppy-code.mjs";
import * as assigned from "./assigned.mjs";
import * as indexed from "./exports-under-indexes.mjs";

const attempt = f => {
  try {
    return String(f());
  } catch (e) {
    return e.constructor.name;
  }
};
const join = (...parts) => parts.join("");

class Returns {
  constructor(value) {
    return value;
  }
}

console.log(
  "named fields:",
  attempt(
    () =>
      new (class extends Returns {
        a1 = undefined;
      })(named) === named,
  ),
  attempt(
    () =>
      new (class extends Returns {
        a2 = undefined;
      })(named) === named,
  ),
  attempt(
    () =>
      new (class extends Returns {
        a5 = 5;
      })(named) === named,
  ),
  attempt(
    () =>
      new (class extends Returns {
        a6 = 7;
      })(named) === named,
  ),
  attempt(
    () =>
      new (class extends Returns {
        missing = 1;
      })(named) === named,
  ),
  attempt(
    () =>
      new (class extends Returns {
        a3;
      })(named) === named,
  ),
  attempt(() => named.used()),
);

console.log(
  "computed fields:",
  attempt(
    () =>
      new (class extends Returns {
        ["a5"] = 5;
      })(computed) === computed,
  ),
  attempt(
    () =>
      new (class extends Returns {
        ["a6"] = 7;
      })(computed) === computed,
  ),
  attempt(
    () =>
      new (class extends Returns {
        ["missing"] = 1;
      })(computed) === computed,
  ),
  attempt(
    () =>
      new (class extends Returns {
        [Symbol.toStringTag] = "Module";
      })(computed) === computed,
  ),
  attempt(
    () =>
      new (class extends Returns {
        [Symbol.toStringTag] = "Other";
      })(computed) === computed,
  ),
  attempt(() => computed.used()),
);

console.log(
  "fields under keys made at run time:",
  attempt(
    () =>
      new (class extends Returns {
        [join("a", "5")] = 5;
      })(late) === late,
  ),
  attempt(
    () =>
      new (class extends Returns {
        [join("a", "6")] = 7;
      })(late) === late,
  ),
  attempt(
    () =>
      new (class extends Returns {
        [join("miss", "ing")] = 1;
      })(late) === late,
  ),
  attempt(() => late.used()),
);

const home = {
  storesTheSameValue() {
    super.a5 = 5;
    return "stored";
  },
  storesAnotherValue() {
    super.a6 = 7;
    return "stored";
  },
  storesANewName() {
    super.missing = 1;
    return "stored";
  },
  storesUnder(key, value) {
    super[key] = value;
    return "stored";
  },
};
console.log(
  "stores through super:",
  attempt(() => home.storesTheSameValue.call(stored)),
  attempt(() => home.storesAnotherValue.call(stored)),
  attempt(() => home.storesANewName.call(stored)),
  attempt(() => stored.used()),
);
console.log(
  "stores through super under keys:",
  attempt(() => home.storesUnder.call(storedUnderKeys, "a5", 5)),
  attempt(() => home.storesUnder.call(storedUnderKeys, "a6", 7)),
  attempt(() => home.storesUnder.call(storedUnderKeys, join("a", "4"), 4)),
  attempt(() => home.storesUnder.call(storedUnderKeys, join("a", "3"), 4)),
  attempt(() => home.storesUnder.call(storedUnderKeys, "missing", 1)),
  attempt(() => storedUnderKeys.used()),
);
console.log(
  "stores through super by sloppy code:",
  attempt(() => sloppy.storesTheSameValue.call(storedBySloppyCode)),
  attempt(() => sloppy.storesAnotherValue.call(storedBySloppyCode)),
  attempt(() => sloppy.storesANewName.call(storedBySloppyCode)),
  attempt(() => storedBySloppyCode.used()),
);

/** @type {any} */
const anyAssigned = assigned;
console.log(
  "plain stores:",
  attempt(() => (anyAssigned.a5 = 5)),
  attempt(() => (anyAssigned.a6 = 7)),
  attempt(() => (anyAssigned["a4"] = 4)),
  attempt(() => (anyAssigned[join("a", "3")] = 3)),
  attempt(() => (anyAssigned.missing = 1)),
  attempt(() => anyAssigned.used()),
);

console.log(
  "exports under indexes:",
  attempt(
    () =>
      new (class extends Returns {
        0 = "zero";
      })(indexed) === indexed,
  ),
  attempt(
    () =>
      new (class extends Returns {
        [1] = "two";
      })(indexed) === indexed,
  ),
  attempt(
    () =>
      new (class extends Returns {
        [3] = "three";
      })(indexed) === indexed,
  ),
  attempt(() => home.storesUnder.call(indexed, 2, "two")),
  attempt(() => home.storesUnder.call(indexed, "2", "three")),
  attempt(
    () =>
      new (class extends Returns {
        named = 1;
      })(indexed) === indexed,
  ),
);
