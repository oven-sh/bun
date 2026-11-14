// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 36

// FILE: main.js
// Each module defines a class at its top level that nothing uses. Defining the class converts each computed key to a property key, which calls the toString or Symbol.toPrimitive method of an object.
const modules = [
  ["method", () => import("./method.js")],
  ["static-method", () => import("./static-method.js")],
  ["getter", () => import("./getter.js")],
  ["setter", () => import("./setter.js")],
  ["field", () => import("./field.js")],
  ["static-field", () => import("./static-field.js")],
  ["generator-method", () => import("./generator-method.js")],
  ["class-expression", () => import("./class-expression.js")],
  ["var-class-expression", () => import("./var-class-expression.js")],
  ["let-key", () => import("./let-key.js")],
  ["var-key", () => import("./var-key.js")],
  ["to-primitive", () => import("./to-primitive.js")],
  ["conversion-throws", () => import("./conversion-throws.js")],
  ["conversion-finds-no-primitive", () => import("./conversion-finds-no-primitive.js")],
  ["object-without-a-prototype", () => import("./object-without-a-prototype.js")],
  ["class-with-a-static-to-string", () => import("./class-with-a-static-to-string.js")],
  ["two-keys-in-order", () => import("./two-keys-in-order.js")],
  ["heritage-before-the-key", () => import("./heritage-before-the-key.js")],
  ["key-behind-a-checked-heritage", () => import("./key-behind-a-checked-heritage.js")],
  ["member-of-an-object", () => import("./member-of-an-object.js")],
  ["imported-object", () => import("./imported-object.js")],
  ["imported-symbol", () => import("./imported-symbol.js")],
  ["imported-text", () => import("./imported-text.js")],
  ["namespace-member", () => import("./namespace-member.js")],
  ["symbol", () => import("./symbol.js")],
  ["well-known-symbol", () => import("./well-known-symbol.js")],
  ["text", () => import("./text.js")],
  ["number", () => import("./number.js")],
  ["undefined", () => import("./undefined.js")],
  ["plain-object", () => import("./plain-object.js")],
  ["array", () => import("./array.js")],
  ["function", () => import("./function.js")],
  ["inspect-custom", () => import("./inspect-custom.js")],
  ["var-assigned-later", () => import("./var-assigned-later.js")],
];
for (const [name, load] of modules) {
  try {
    await load();
    console.log(name, "loaded");
  } catch (error) {
    console.log(name, error.name, error.message);
  }
}

// FILE: array.js
const key = [1, 2];
class Unused {
  [key]() {}
}

// FILE: class-expression.js
const key = {
  toString() {
    console.log("converted");
    return "name";
  },
};
const Unused = class {
  [key]() {}
};

// FILE: class-with-a-static-to-string.js
class Key {
  static toString() {
    console.log("converted");
    return "name";
  }
}
class Unused {
  [Key]() {}
}

// FILE: conversion-finds-no-primitive.js
const key = {
  toString() {
    return {};
  },
  valueOf() {
    return {};
  },
};
class Unused {
  [key]() {}
}

// FILE: conversion-throws.js
const key = {
  toString() {
    throw new RangeError("no key");
  },
};
class Unused {
  [key]() {}
}

// FILE: field.js
const key = {
  toString() {
    console.log("converted");
    return "name";
  },
};
class Unused {
  [key] = 1;
}

// FILE: function.js
const key = function () {};
class Unused {
  [key]() {}
}

// FILE: generator-method.js
const key = {
  toString() {
    console.log("converted");
    return "name";
  },
};
class Unused {
  *[key]() {}
}

// FILE: getter.js
const key = {
  toString() {
    console.log("converted");
    return "name";
  },
};
class Unused {
  get [key]() {
    return 1;
  }
}

// FILE: heritage-before-the-key.js
const key = {
  toString() {
    console.log("converted");
    return "name";
  },
};
class Unused extends {} {
  [key]() {}
}

// FILE: imported-object.js
import { printing } from "./keys/keys.js";
class Unused {
  [printing]() {}
}

// FILE: imported-symbol.js
import { symbol } from "./keys/keys.js";
class Unused {
  [symbol]() {}
}

// FILE: imported-text.js
import { text } from "./keys/keys.js";
class Unused {
  [text]() {}
}

// FILE: inspect-custom.js
import { inspect } from "node:util";
class Unused {
  [inspect.custom]() {}
}

// FILE: key-behind-a-checked-heritage.js
const key = {
  toString() {
    console.log("converted");
    return "name";
  },
};
function Base() {}
class Unused extends Base {
  [key]() {}
}

// FILE: keys/keys.js
export const printing = {
  toString() {
    console.log("converted");
    return "name";
  },
};
export const symbol = Symbol("key");
export const text = "name";

// FILE: let-key.js
let key = {
  toString() {
    console.log("converted");
    return "name";
  },
};
class Unused {
  [key]() {}
}

// FILE: member-of-an-object.js
const keys = {
  key: {
    toString() {
      console.log("converted");
      return "name";
    },
  },
};
class Unused {
  [keys.key]() {}
}

// FILE: method.js
const key = {
  toString() {
    console.log("converted");
    return "name";
  },
};
class Unused {
  [key]() {}
}

// FILE: namespace-member.js
import * as keys from "./keys/keys.js";
class Unused {
  [keys.printing]() {}
}

// FILE: number.js
const key = 5;
class Unused {
  [key]() {}
}

// FILE: object-without-a-prototype.js
const key = Object.create(null);
class Unused {
  [key]() {}
}

// FILE: plain-object.js
const key = {};
class Unused {
  [key]() {}
}

// FILE: setter.js
const key = {
  toString() {
    console.log("converted");
    return "name";
  },
};
class Unused {
  set [key](value) {}
}

// FILE: static-field.js
const key = {
  toString() {
    console.log("converted");
    return "name";
  },
};
class Unused {
  static [key] = 1;
}

// FILE: static-method.js
const key = {
  toString() {
    console.log("converted");
    return "name";
  },
};
class Unused {
  static [key]() {}
}

// FILE: symbol.js
const key = Symbol("key");
class Unused {
  [key]() {}
  static [key]() {}
}

// FILE: text.js
const key = "name";
class Unused {
  [key]() {}
  static [key]() {}
}

// FILE: to-primitive.js
const key = {
  [Symbol.toPrimitive](hint) {
    console.log("converted", hint);
    return "name";
  },
};
class Unused {
  [key]() {}
}

// FILE: two-keys-in-order.js
const first = {
  toString() {
    console.log("first");
    return "a";
  },
};
const second = {
  toString() {
    console.log("second");
    return "b";
  },
};
class Unused {
  [first]() {}
  plain() {}
  [second] = 1;
}

// FILE: undefined.js
let key;
class Unused {
  [key]() {}
}

// FILE: var-assigned-later.js
class Unused {
  [key]() {}
}
var key = {
  toString() {
    console.log("converted");
    return "name";
  },
};

// FILE: var-class-expression.js
const key = {
  toString() {
    console.log("converted");
    return "name";
  },
};
var Unused = class {
  [key]() {}
};

// FILE: var-key.js
var key = {
  toString() {
    console.log("converted");
    return "name";
  },
};
class Unused {
  [key]() {}
}

// FILE: well-known-symbol.js
class Unused {
  [Symbol.iterator]() {}
  static [Symbol.hasInstance]() {}
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
