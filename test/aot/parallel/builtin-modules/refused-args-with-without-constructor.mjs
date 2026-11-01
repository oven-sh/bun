// What the message of a refused argument says, and which code of the argument runs, for arguments with and without a constructor.
import * as path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
const custom = Symbol.for("nodejs.util.inspect.custom");
function tell(name, makeOperand, call) {
  let count = 0;
  const box = { field: 1 };
  const operand = makeOperand(() => {
    count++;
    box.field = 2;
  });
  let message = "no error";
  try {
    call(operand);
  } catch (error) {
    message = error.message;
  }
  console.log(name, "|", message, "|", count, box.field);
}
const withGetter = hit => ({
  get constructor() {
    hit();
    return { name: "Named" };
  },
});
const withNameObject = hit => ({
  constructor: {
    name: {
      toString() {
        hit();
        return "Converted";
      },
    },
  },
});
const withNameGetter = hit => ({
  constructor: {
    get name() {
      hit();
      return "Got";
    },
  },
});
const withoutPrototype = hit =>
  Object.assign(Object.create(null), {
    [custom]() {
      hit();
      return "custom";
    },
  });
const literalWithoutPrototype = hit => ({
  __proto__: null,
  [custom]() {
    hit();
    return "custom";
  },
});
const withFalsyConstructor = hit => ({
  constructor: 0,
  [custom]() {
    hit();
    return "custom";
  },
});
const withUndefinedConstructor = hit => ({
  constructor: undefined,
  [custom]() {
    hit();
    return "custom";
  },
});
const cutLater = hit =>
  Object.setPrototypeOf(
    {
      [custom]() {
        hit();
        return "custom";
      },
    },
    null,
  );
function Made(hit) {
  this[custom] = () => {
    hit();
    return "custom";
  };
}
Made.prototype = Object.create(null);
const madeBelowNothing = hit => new Made(hit);
class Below extends null {
  static make(hit) {
    const made = Object.create(Below.prototype);
    made[custom] = () => {
      hit();
      return "custom";
    };
    return made;
  }
}
const kinds = {
  withGetter,
  withNameObject,
  withNameGetter,
  withoutPrototype,
  literalWithoutPrototype,
  withFalsyConstructor,
  withUndefinedConstructor,
  cutLater,
  madeBelowNothing,
  belowNull: hit => Below.make(hit),
};
for (const [kind, make] of Object.entries(kinds)) {
  tell("alloc " + kind, make, v => Buffer.alloc(v));
  tell("compare " + kind, make, v => Buffer.compare(v, v));
  tell("microtask " + kind, make, v => queueMicrotask(v));
}
tell("concat element", withGetter, v => Buffer.concat([v]));
tell("concat element without prototype", withoutPrototype, v => Buffer.concat([v]));
tell("gzip level", withGetter, v => zlib.gzipSync(Buffer.alloc(1), { level: v }));
tell("randomFill offset", withGetter, v => crypto.randomFillSync(Buffer.alloc(4), v));
tell("scrypt option", withGetter, v => crypto.scryptSync("a", "b", 8, { N: v }));
tell(
  "namespace",
  () => path,
  v => {
    try {
      Buffer.alloc(v);
    } catch (error) {
      throw new Error(error.message.slice(0, 70));
    }
  },
);
