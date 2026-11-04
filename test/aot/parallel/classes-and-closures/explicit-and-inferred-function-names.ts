// Bun.inspect() names an element by the name written in its type: a function or class that only takes a name from where it is written has none, though its `name` property says it.
const element = (type: unknown) => ({ $$typeof: Symbol.for("react.element"), type, key: null, ref: null, props: {} });

const Arrow = () => null;
function Declared() {
  return null;
}
const Expression = function () {
  return null;
};
const Named = function Own() {
  return null;
};
const AsyncArrow = async () => null;
const AnonymousClass = class {
  m() {}
};
const NamedClass = class Own {
  m() {}
};
class DeclaredClass {
  m() {}
}
class WithFields {
  field = () => null;
  static fixed = function () {};
}
const held = {
  Method() {
    return null;
  },
  Property: () => null,
  Written: function Own() {},
  [Symbol.iterator]() {
    return [][Symbol.iterator]();
  },
};
let assigned;
assigned = () => null;
const { byDefault = () => null } = {} as { byDefault?: () => null };
const bound = Arrow.bind(null);
const boundDeclared = Declared.bind(null);
const total = Object.getOwnPropertyDescriptor(
  {
    get total() {
      return 1;
    },
    set total(value: number) {},
  },
  "total",
)!;

const all: [string, Function][] = [
  ["an arrow", Arrow],
  ["a declaration", Declared],
  ["a function expression", Expression],
  ["a function expression with a name", Named],
  ["an async arrow", AsyncArrow],
  ["a class expression", AnonymousClass],
  ["a class expression with a name", NamedClass],
  ["a class declaration", DeclaredClass],
  ["an arrow in a field", new WithFields().field],
  ["a function in a static field", WithFields.fixed],
  ["a method", held.Method],
  ["an arrow in a property", held.Property],
  ["a function with a name in a property", held.Written],
  ["an arrow that is assigned", assigned],
  ["an arrow that is a default", byDefault],
  ["a method named by a symbol", held[Symbol.iterator]],
  ["a bound arrow", bound],
  ["a bound declaration", boundDeclared],
  ["a getter", total.get!],
  ["a setter", total.set!],
];
for (const [what, f] of all) console.log(what + ":", JSON.stringify(f.name), Bun.inspect(element(f)), Bun.inspect(f));
