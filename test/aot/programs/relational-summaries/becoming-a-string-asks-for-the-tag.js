// An object without valueOf, toString or Symbol.toPrimitive of its own still runs code when a callee makes a string or a number of it: Object.prototype.toString reads Symbol.toStringTag, Array.prototype.toString reads join, join converts every element, and each of these may be an accessor or a method that keeps `this`.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept = [];
const report = () => kept.splice(0).map(k => k.tag).join("+") || "nobody";
const converters = {
  template: thing => `${thing}`,
  concatenation: thing => thing + "",
  string: thing => String(thing),
  number: thing => String(+thing),
  loose: thing => String(thing == "[object Spied]"),
  relational: thing => String(thing < "a"),
  key: thing => Object.keys({ [thing]: 1 })[0],
  strict: thing => String(thing === "x") + typeof thing + !thing + (thing == null),
};
const makers = {
  plain: () => ({ tag: "plain" }),
  ownTag: () => ({
    tag: "ownTag",
    get [Symbol.toStringTag]() {
      kept.push(this);
      return "Spied";
    },
  }),
  lateTag: () =>
    Object.defineProperty({ tag: "lateTag" }, Symbol.toStringTag, {
      get() {
        kept.push(this);
        return "Spied";
      },
    }),
  classTag() {
    class Tagged {
      tag = "classTag";
      get [Symbol.toStringTag]() {
        kept.push(this);
        return "Spied";
      }
    }
    return new Tagged();
  },
  valueOfAccessor: () => ({
    tag: "valueOfAccessor",
    get valueOf() {
      kept.push(this);
      return undefined;
    },
  }),
  toStringField() {
    const thing = { tag: "toStringField" };
    thing.toString = function () {
      kept.push(this);
      return "field";
    };
    return thing;
  },
  nullPrototype: () => ({ __proto__: null, tag: "nullPrototype", toString: () => "bare" }),
  array: () => Object.assign([1, 2], { tag: "array" }),
  arrayOwnJoin() {
    const list = Object.assign([1, 2], { tag: "arrayOwnJoin" });
    list.join = function () {
      kept.push(this);
      return "joined";
    };
    return list;
  },
  arrayOfSpies: () =>
    Object.assign(
      [
        {
          tag: "element",
          toString() {
            kept.push(this);
            return "e";
          },
        },
      ],
      { tag: "arrayOfSpies" },
    ),
  closure: () => Object.assign(() => 1, { tag: "closure" }),
  closureOwnToString() {
    const closure = Object.assign(() => 1, { tag: "closureOwnToString" });
    Object.defineProperty(closure, "toString", {
      get() {
        kept.push(this);
        return () => "spied closure";
      },
    });
    return closure;
  },
};
const lines = [];
for (const [converter, convert] of Object.entries(converters)) {
  for (const [name, make] of Object.entries(makers)) {
    lines.push(converter + " " + name + " " + convert(make()));
    churn(20);
    lines.push(report());
  }
}
console.log(lines.join("\n"));
