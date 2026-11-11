// Where fields are assigned ("useDefineForClassFields": false), a private field stays a field unless the class assigns a plain field.
// Until then every private field was assigned in the constructor, behind the parameters and the parameter properties.
let seen: string[] = [];
const t = (name: string) => (seen.push(name), name);
const tell = (label: string, make: () => unknown) => {
  seen = [];
  const made = make();
  console.log(label, seen.join() || "nothing", typeof made === "object" ? "" : String(made));
};
class Parent {
  x = 0;
  constructor(public arg: string) {
    t("parent");
  }
}
tell("alone", () => {
  class A {
    #id = t("#id");
    constructor(public seq = t("seq")) {
      t("body");
    }
    id() {
      return this.#id;
    }
  }
  return new A();
});
tell("two, the second without a value", () => {
  class A {
    #a = t("#a");
    #b: string | undefined;
    constructor(public seq = t("seq")) {
      t("body " + (#b in this));
    }
    a() {
      return this.#a;
    }
  }
  return new A();
});
tell("beside a field without a value", () => {
  class A {
    n?: number;
    #id = t("#id");
    constructor(public seq = t("seq")) {
      t("body " + Object.keys(this).join());
    }
    id() {
      return this.#id;
    }
  }
  return new A();
});
tell("beside a static field", () => {
  class A {
    static s = t("s");
    #id = t("#id");
    constructor(public seq = t("seq")) {
      t("body");
    }
    id() {
      return this.#id;
    }
  }
  return new A();
});
tell("without a constructor", () => {
  class A {
    #id = t("#id");
    id() {
      return this.#id;
    }
  }
  return new A().id();
});
tell("a class expression", () => {
  const A = class {
    #id = t("#id");
    constructor(public seq = t("seq")) {
      t("body");
    }
    id() {
      return this.#id;
    }
  };
  return new A();
});
tell("below a parent", () => {
  class A extends Parent {
    #id = t("#id");
    constructor(public seq = t("seq")) {
      super(t("super arg"));
      t("body");
    }
    id() {
      return this.#id;
    }
  }
  return new A();
});
tell("below a parent, without a constructor", () => {
  class A extends Parent {
    #id = t("#id");
    id() {
      return this.#id;
    }
  }
  return new A("arg").id();
});
tell("below a parent, super() in a branch", () => {
  class A extends Parent {
    #id = t("#id");
    constructor(first: boolean) {
      // @ts-expect-error TS2401: tsc wants super() at the root of the body beside a private field
      if (first) super(t("first"));
      else super(t("second"));
      t("body");
    }
    id() {
      return this.#id;
    }
  }
  return new A(false);
});
tell("reads a parameter property", () => {
  class A {
    #read = this.x;
    constructor(public x: number) {}
    read() {
      return this.#read;
    }
  }
  return String(new A(5).read());
});
tell("reads a parameter property below a parent", () => {
  class A extends Parent {
    #read = this.x;
    constructor(public x: number) {
      super("");
    }
    read() {
      return this.#read;
    }
  }
  return new A(5).read();
});
tell("names its function", () => {
  class A {
    #f = () => {};
    #c = class {};
    names() {
      return [this.#f.name, this.#c.name].join();
    }
  }
  return new A().names();
});
tell("evaluates text", () => {
  class A {
    #found = eval("typeof given");
    constructor(given: string) {
      t(given);
    }
    found(): unknown {
      return this.#found;
    }
  }
  return new A("body").found();
});
tell("ahead of a field with a value", () => {
  class A {
    #id = t("#id");
    n = t("n");
    constructor(public seq = t("seq")) {
      t("body");
    }
    id() {
      return this.#id;
    }
  }
  return new A();
});
tell("behind a field with a value", () => {
  class A {
    n = t("n");
    #id = t("#id");
    constructor(public seq = t("seq")) {
      t("body");
    }
    id() {
      return this.#id;
    }
  }
  return new A();
});
tell("reads a parameter property beside a field with a value", () => {
  class A {
    #read = this.x;
    n = 0;
    constructor(public x: number) {}
    read() {
      return this.#read;
    }
  }
  return new A(5).read();
});
tell("evaluates text beside a field with a value", () => {
  class A {
    #found = eval("typeof given");
    n = 0;
    constructor(given: string) {
      t(given);
    }
    found(): unknown {
      return this.#found;
    }
  }
  return new A("body").found();
});
export {};
