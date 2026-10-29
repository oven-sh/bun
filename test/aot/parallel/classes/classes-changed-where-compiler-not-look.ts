// Methods, getters and prototype links of top-level classes are changed by code whose target and name the compiler cannot see: before a subclass is defined, between two definitions, and while instances exist.
const join = (...parts: string[]): string => parts.join("");
const hidden = (value: unknown): any => [value][Number(join("0"))];

class Base {
  value = 1;
  greet(): string {
    return "Base.greet";
  }
  get size(): number {
    return 10;
  }
  shared(): string {
    return "Base.shared";
  }
  kept(): string {
    return "Base.kept";
  }
  static make(): string {
    return "Base.make";
  }
  static other(): string {
    return "Base.other";
  }
}
function useBase(object: Base): string {
  return [object.greet(), object.size, object.shared(), object.kept()].join(" | ");
}
console.log("as defined:", useBase(new Base()), "|", Base.make(), "|", Base.other());

hidden(Base).prototype[join("gr", "eet")] = function () {
  return "greet, stored before Derived is defined";
};

class Derived extends Base {
  shared(): string {
    return "Derived.shared";
  }
}
function useDerived(object: Derived): string {
  return [object.greet(), object.size, object.shared(), object.kept()].join(" | ");
}
console.log("a method stored before the subclass:", useDerived(new Derived()), "||", useBase(new Derived()), "||", useBase(new Base()));

Object.defineProperty(hidden(Base.prototype), join("si", "ze"), {
  get() {
    return 20;
  },
  configurable: true,
});

class Leaf extends Derived {
  kept(): string {
    return "Leaf.kept";
  }
}
function useLeaf(object: Leaf): string {
  return [object.greet(), object.size, object.shared(), object.kept()].join(" | ");
}
console.log("a getter defined between two definitions:", useLeaf(new Leaf()), "||", useDerived(new Derived()), "||", useBase(new Base()));

const leaf = new Leaf();
const derived = new Derived();
delete hidden(Derived.prototype)[join("sha", "red")];
console.log("a method deleted:", useLeaf(leaf), "||", useDerived(derived), "||", useBase(leaf));

hidden(Derived.prototype)[join("ke", "pt")] = function () {
  return "kept, added in the middle of the chain";
};
console.log("a method added in the middle:", useLeaf(leaf), "||", useDerived(derived), "||", useBase(new Base()));

hidden(leaf)[join("gr", "eet")] = function () {
  return "greet, an own property of one instance";
};
console.log("a method hidden by an instance:", useLeaf(leaf), "||", useLeaf(new Leaf()), "||", useBase(leaf));

hidden(Base)[join("ma", "ke")] = function () {
  return "make, stored on the class object";
};
console.log("a static method stored:", Base.make(), "|", Derived.make(), "|", Leaf.make(), "|", Leaf.other());
Object.defineProperty(hidden(Derived), join("ot", "her"), {
  value() {
    return "other, defined on Derived";
  },
  configurable: true,
  writable: true,
});
console.log("a static method defined below:", Base.other(), "|", Derived.other(), "|", Leaf.other());

Object.setPrototypeOf(hidden(Derived.prototype), {
  greet() {
    return "greet of another parent";
  },
  shared() {
    return "shared of another parent";
  },
  kept() {
    return "kept of another parent";
  },
  size: 30,
});
console.log("another parent for a prototype object:", useLeaf(new Leaf()), "||", useDerived(new Derived()), "||", useBase(new Base()), "||", new Leaf() instanceof Base);

Object.setPrototypeOf(hidden(Derived), {
  make() {
    return "make of another parent";
  },
  other() {
    return "other of another parent";
  },
});
console.log("another parent for a class object:", Base.make(), "|", Derived.make(), "|", Leaf.make(), "|", Leaf.other());

class Untouched {
  first(): string {
    return "Untouched.first";
  }
  static second(): string {
    return "Untouched.second";
  }
}
class BelowUntouched extends Untouched {}
console.log("classes that nobody changed:", new Untouched().first(), "|", new BelowUntouched().first(), "|", BelowUntouched.second());
