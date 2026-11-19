// `__proto__: value` in a literal lays `value` above it only where that is an object or null. The short form, a method and a getter of that name are own properties.
// So is `["__proto__"]: value`. And `new` may give Object.prototype itself.
// In all those cases Object.prototype lies above the literal, and a test may lay a name there. The controls: an object and null as written.
import { test } from "bun:test";
const reads = (name: string) => [({} as any)[name], name in {}];
const seven: number = JSON.parse("7");
function shortForm() {
  const __proto__ = 1;
  const above: any = Object.getPrototypeOf({ __proto__ });
  above.short = seven;
  try {
    return reads("short");
  } finally {
    delete above.short;
  }
}
function aNumber() {
  const above: any = Object.getPrototypeOf({ __proto__: 1 });
  above.numbered = seven;
  try {
    return reads("numbered");
  } finally {
    delete above.numbered;
  }
}
function undefinedAsWritten() {
  const above: any = Reflect.getPrototypeOf({ __proto__: undefined });
  above.absent = seven;
  try {
    return reads("absent");
  } finally {
    delete above.absent;
  }
}
function aValueOfTheRun() {
  const above: any = Object.getPrototypeOf({ "__proto__": seven, kept: 1 });
  above.run = seven;
  try {
    return reads("run");
  } finally {
    delete above.run;
  }
}
function aMethod() {
  const above: any = Object.getPrototypeOf({
    __proto__() {
      return 1;
    },
  });
  above.method = seven;
  try {
    return reads("method");
  } finally {
    delete above.method;
  }
}
function aGetter() {
  const above: any = Object.getPrototypeOf({
    get __proto__() {
      return 1;
    },
  });
  above.getter = seven;
  try {
    return reads("getter");
  } finally {
    delete above.getter;
  }
}
function aComputedText() {
  const above: any = Object.getPrototypeOf({ ["__proto__"]: null });
  above.computed = seven;
  try {
    return reads("computed");
  } finally {
    delete above.computed;
  }
}
class Gives {
  constructor() {
    return Object.prototype;
  }
}
function whatAConstructorGives() {
  const above: any = Object.getPrototypeOf({ __proto__: new Gives() });
  above.given = seven;
  try {
    return reads("given");
  } finally {
    delete above.given;
  }
}
function anObject() {
  const above: any = Object.getPrototypeOf({ __proto__: { mine: 3 } });
  above.inner = seven;
  return [above.mine, above.inner, reads("inner")];
}
function nothing() {
  return Object.getPrototypeOf({ __proto__: null });
}
test("t", () => {
  console.log("SAID", aComputedText(), whatAConstructorGives(), reads("computed"), reads("given"));
  console.log(
    "SAID",
    shortForm(),
    aNumber(),
    undefinedAsWritten(),
    aValueOfTheRun(),
    aMethod(),
    aGetter(),
    anObject(),
    nothing(),
  );
  console.log(
    "SAID",
    reads("short"),
    reads("numbered"),
    reads("absent"),
    reads("run"),
    reads("method"),
    reads("getter"),
  );
});
