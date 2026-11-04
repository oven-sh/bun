// A literal with `__proto__` that nothing needs as a cell. What it does not hold itself is found above that prototype, never above Object.prototype.
export {};

const base = {
  inherited: "inherited",
  get viaGetter() {
    return "getter sees " + this.own;
  },
  set viaSetter(value) {
    this.stored = "setter got " + value;
  },
};
const fixed = Object.freeze({ locked: "locked" });
class Shape {
  area() {
    return "area of " + this.own;
  }
}

function belowNull() {
  const o = { __proto__: null, own: 1 };
  return [typeof o.toString, o.own, "toString" in o, "own" in o, Object.getPrototypeOf(o) === null, o instanceof Object].join();
}

function belowObject(p) {
  const o = { __proto__: p, own: "mine" };
  return [o.inherited, o.viaGetter, "inherited" in o, Object.hasOwn(o, "inherited"), Object.getPrototypeOf(o) === p, p.isPrototypeOf(o)].join();
}

function storeMeetsSetter(p) {
  const o = { __proto__: p, own: "mine" };
  o.viaSetter = 5;
  return o.stored + " " + Object.keys(o).join("+");
}

function storeMeetsReadOnly(p) {
  const o = { __proto__: p, own: "mine" };
  try {
    o.locked = "changed";
  } catch (error) {
    return (error instanceof TypeError) + " " + o.locked + " " + Object.keys(o).join("+");
  }
  return "stored " + o.locked;
}

function definitionPassesSetter(p) {
  const o = { __proto__: p, viaSetter: "own value", inherited: "own too" };
  return [o.viaSetter, o.inherited, typeof o.stored, Object.keys(o).join("+")].join();
}

function valuesThatAreIgnored() {
  const results = [];
  for (const value of [1, "text", undefined, true, 2n, Symbol.iterator]) {
    const o = { __proto__: value, own: 1 };
    results.push(Object.getPrototypeOf(o) === Object.prototype && typeof o.toString === "function" && !Object.hasOwn(o, "__proto__"));
  }
  return results.join();
}

function otherSpellings(p) {
  const __proto__ = p;
  const shorthand = { __proto__ };
  const computed = { ["__proto__"]: p };
  // prettier-ignore
  const quoted = { "__proto__": p };
  return [
    Object.hasOwn(shorthand, "__proto__"),
    typeof shorthand.inherited,
    Object.hasOwn(computed, "__proto__"),
    typeof computed.inherited,
    Object.hasOwn(quoted, "__proto__"),
    typeof quoted.inherited,
  ].join();
}

function oneOfTwoLiterals(flag, p) {
  const o = flag ? { __proto__: p, x: 1 } : { __proto__: null, x: 2 };
  return o.x + " " + o.inherited;
}

function oneOfTwoPrototypes(flag, p) {
  const o = { __proto__: flag ? p : null, x: 3 };
  return o.x + " " + o.inherited + " " + typeof o.hasOwnProperty;
}

function withAndWithout(flag, p) {
  const o = flag ? { __proto__: p, y: 1 } : { y: 2 };
  return o.y + " " + o.inherited + " " + typeof o.hasOwnProperty;
}

function throughLoop(p) {
  const o = { __proto__: p, n: 0 };
  for (let i = 0; i < 4; i++) o.n += i;
  return o.n + " " + o.inherited;
}

function inEachTurn(p) {
  let text = "";
  for (let i = 0; i < 3; i++) {
    const o = { __proto__: i === 1 ? null : p, n: i };
    text += o.n + String(o.inherited) + ";";
  }
  return text;
}

function fail(flag) {
  if (flag) throw new Error("thrown");
}

function underHandler(flag, p) {
  const o = { __proto__: p, x: "first" };
  try {
    fail(flag);
    o.x = "second";
    fail(!flag);
  } catch {
    return "caught " + o.x + " " + o.inherited;
  }
  return "not caught";
}

function prototypeIsLiteral() {
  const o = { __proto__: { deep: "deep", __proto__: null }, own: 1 };
  return [o.deep, typeof o.toString, Object.keys(Object.getPrototypeOf(o)).join("+")].join();
}

function nativeLookups(p) {
  const keys = [];
  for (const key in { __proto__: p, own: 1 }) keys.push(key);
  return [
    keys.join("+"),
    Object.keys({ ...{ __proto__: p, own: 1 } }).join("+"),
    JSON.stringify({
      __proto__: {
        toJSON() {
          return "from toJSON";
        },
      },
      own: 1,
    }),
    `${{
      __proto__: {
        toString() {
          return "from toString";
        },
      },
    }}`,
    Object.assign({ __proto__: p }, { viaSetter: 9 }).stored,
  ].join();
}

function convertsBelowNull() {
  try {
    return String({ __proto__: null });
  } catch (error) {
    return "TypeError: " + (error instanceof TypeError);
  }
}

function methods(p) {
  const o = {
    __proto__: p,
    own: "circle",
    describe() {
      return super.area() + "!";
    },
  };
  return [o.area(), o.describe(), o instanceof Shape].join();
}

async function awaited() {
  return await {
    __proto__: {
      then(resolve) {
        resolve("then ran");
      },
    },
    own: 1,
  };
}

async function returned() {
  return {
    __proto__: {
      then(resolve) {
        resolve("then ran on return");
      },
    },
  };
}

console.log(belowNull());
console.log(belowObject(base));
console.log(storeMeetsSetter(base));
console.log(storeMeetsReadOnly(fixed));
console.log(definitionPassesSetter(base));
console.log(valuesThatAreIgnored());
console.log(otherSpellings(base));
console.log(oneOfTwoLiterals(true, base), oneOfTwoLiterals(false, base));
console.log(oneOfTwoPrototypes(true, base), oneOfTwoPrototypes(false, base));
console.log(withAndWithout(true, base), withAndWithout(false, base));
console.log(throughLoop(base));
console.log(inEachTurn(base));
console.log(underHandler(true, base), underHandler(false, base));
console.log(prototypeIsLiteral());
console.log(nativeLookups(base));
console.log(convertsBelowNull());
console.log(methods(Shape.prototype));
console.log(await awaited());
console.log(await returned());
console.log(Object.keys(base).join("+"));
