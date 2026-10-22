// A store to a field that the object lacks asks the chain first: a setter, a getter without a setter, a read-only property or a Proxy up there decides. They appear and go away after the store has created the field on earlier objects.
class Root {
  kind = "root";
}
class Leaf extends Root {
  id = 1;
  declare color?: string;
}

const trail: string[] = [];

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
function paint(leaf: Leaf, color: string): void {
  leaf.color = color;
}
function colorOf(leaf: Leaf): unknown {
  return leaf.color;
}
function look(mark: string, leaf: Leaf = new Leaf()): void {
  console.log(mark + ":", attempt(() => paint(leaf, "red")), String(colorOf(leaf)), Object.hasOwn(leaf, "color"), attempt(() => paint(leaf, "blue")), String(colorOf(leaf)), Object.keys(leaf).join(), trail.splice(0).join(";"));
}

const early = new Leaf();
look("nothing above", early);
look("nothing above");

Object.defineProperty(Leaf.prototype, "color", {
  set(value: string) {
    trail.push("setter " + value + " for " + (this as Leaf).id);
  },
  get() {
    return "from the getter";
  },
  configurable: true,
});
look("a setter on the prototype");
look("an object that has the field already", early);

Object.defineProperty(Leaf.prototype, "color", { get: () => "getter alone", set: undefined, configurable: true });
look("a getter alone");
look("an object that has the field already", early);

Object.defineProperty(Leaf.prototype, "color", { value: "read-only above", writable: false, configurable: true });
look("read-only above");

Object.defineProperty(Leaf.prototype, "color", { value: "writable above", writable: true, configurable: true });
look("writable above");

delete (Leaf.prototype as any).color;
look("nothing above again");

Object.defineProperty(Root.prototype, "color", {
  set(value: string) {
    trail.push("setter two levels up " + value);
    Object.defineProperty(this, "color", { value: value + " defined by the setter", writable: true, enumerable: true, configurable: true });
  },
  configurable: true,
});
look("a setter two levels up that defines the field");
delete (Root.prototype as any).color;

const underProxy = new Leaf();
Object.setPrototypeOf(
  underProxy,
  new Proxy(Leaf.prototype, {
    set(target, key, value, receiver) {
      trail.push("trap " + String(key) + " " + value + " " + (receiver === underProxy));
      return key !== "color" || value !== "blue";
    },
  }),
);
look("a proxy above that swallows the store", underProxy);

const underSilentProxy = new Leaf();
Object.setPrototypeOf(underSilentProxy, new Proxy(Leaf.prototype, {}));
look("a proxy above without traps", underSilentProxy);

const underLiteral: Leaf = Object.setPrototypeOf(new Leaf(), {
  set color(value: string) {
    trail.push("setter of a literal " + value);
  },
});
look("another prototype with a setter", underLiteral);

const parsed: Leaf = Object.setPrototypeOf(JSON.parse('{"id":2,"kind":"parsed"}'), {
  set color(value: string) {
    trail.push("setter above a parsed object " + value);
  },
});
look("a parsed object below a setter", parsed);
look("a parsed object", JSON.parse('{"id":3,"kind":"parsed"}'));
look("nothing above at last");

export {};
