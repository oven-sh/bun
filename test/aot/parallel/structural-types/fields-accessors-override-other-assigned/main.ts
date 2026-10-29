// Fields and accessors override each other when fields are assigned.
const log: string[] = [];

function attempt(label: string, body: () => unknown): void {
  log.length = 0;
  try {
    console.log(label + ": " + String(body()) + " [" + log.join(", ") + "]");
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error) + " [" + log.join(", ") + "]");
  }
}

function facts(value: { level: number }): string {
  return value.level + " own " + Object.hasOwn(value, "level") + " keys " + Object.keys(value).join() + " json " + JSON.stringify(value);
}

class FieldBase {
  level = 1;
  empty: number | undefined;
  read(): number {
    return this.level;
  }
}

class AccessorBelow extends FieldBase {
  seen = "seen";
}

Object.defineProperty(AccessorBelow.prototype, "level", {
  get() {
    log.push("get below");
    return 42;
  },
  set(value: number) {
    log.push("set below " + value);
  },
  configurable: true,
});

Object.defineProperty(AccessorBelow.prototype, "empty", {
  get() {
    log.push("get empty");
    return -1;
  },
  set(value: number | undefined) {
    log.push("set empty " + value);
  },
  configurable: true,
});

interface AccessorBase {
  level: number;
}

class AccessorBase {
  hidden = 1;
  read(): number {
    return this.level;
  }
}

Object.defineProperty(AccessorBase.prototype, "level", {
  get(this: AccessorBase) {
    log.push("get base");
    return this.hidden * 10;
  },
  set(this: AccessorBase, value: number) {
    log.push("set base " + value);
    this.hidden = value;
  },
  configurable: true,
});

class FieldBelow extends AccessorBase {
  level = 5;
}

class EmptyFieldBelow extends AccessorBase {
  level: number;
  constructor() {
    super();
    log.push("own after super: " + Object.hasOwn(this, "level"));
    this.level = 6;
  }
}

interface Leveled {
  level: number;
}

const Typed: new () => Leveled = class {
  level = 1;
};

class PairBelowTyped extends Typed {
  get level(): number {
    log.push("get pair");
    return 77;
  }
  set level(value: number) {
    log.push("set pair " + value);
  }
}

function readField(b: FieldBase): number {
  return b.level;
}

function writeField(b: FieldBase, value: number): number {
  b.level = value;
  return b.level;
}

function readAccessor(b: AccessorBase): number {
  return b.level;
}

attempt("a field in the base", () => facts(new FieldBase()));
attempt("an accessor on the subclass's prototype under that field", () => facts(new AccessorBelow()));
attempt("read through the base's type", () => readField(new AccessorBelow()) + " " + new AccessorBelow().read());
attempt("stored through the base's type", () => writeField(new AccessorBelow(), 9));
attempt("the field without an initializer", () => {
  const made = new AccessorBelow();
  return made.empty + " own " + Object.hasOwn(made, "empty");
});

attempt("an accessor in the base", () => facts(new AccessorBase()));
attempt("a field with an initializer in the subclass", () => facts(new FieldBelow()) + " hidden " + new FieldBelow().hidden);
attempt("read through the base's type", () => readAccessor(new FieldBelow()) + " " + new FieldBelow().read());
attempt("a field stored by the subclass's constructor", () => facts(new EmptyFieldBelow()));

attempt("a pair under a field of a base typed by an interface", () => facts(new PairBelowTyped()));

let warm = 0;
const honest = new FieldBase();
for (let i = 0; i < 2000; i++) warm += readField(honest) + writeField(honest, i) + new FieldBase().read();
console.log("2000 honest: " + warm);
attempt("then the subclass with the accessor", () => readField(new AccessorBelow()) + " " + writeField(new AccessorBelow(), 3) + " " + new AccessorBelow().read());
