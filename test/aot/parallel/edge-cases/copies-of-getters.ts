// { ...object } and a rest of an object with getters, each made several times: a later copy goes by what an earlier one learned about where the properties lie.
const calls: string[] = [];

function show(label: string, copy: object) {
  const properties = Reflect.ownKeys(copy).map(key => String(key) + "=" + String((copy as any)[key]));
  console.log(label, properties.join(), "|", calls.splice(0).join());
}

function plain(n: number) {
  return {
    a: n,
    get b() {
      calls.push("b");
      return this.a + 1;
    },
    c: n * 2,
    get d() {
      calls.push("d");
      return this.c + 1;
    },
  };
}

for (let i = 0; i < 3; i++) {
  show("plain", { ...plain(i) });
  const { b, c, ...rest } = plain(i);
  show("rest", rest);
  show("between", { z: 0, ...plain(i), c: "last" });
  show("and more", { ...plain(i), c: "last", e: i });
  if (i == 1) Bun.gc(true);
}

let deed = "";

function moving(n: number) {
  const made = {
    a: n,
    get b() {
      calls.push("b");
      const self = this as any;
      if (deed == "delete") delete self.c;
      if (deed == "add") self.added = 1;
      if (deed == "hide") Object.defineProperty(self, "c", { enumerable: false });
      if (deed == "unhide") Object.defineProperty(self, "hidden", { enumerable: true });
      if (deed == "other getter") {
        Object.defineProperty(self, "d", {
          get() {
            calls.push("other d");
            return -1;
          },
        });
      }
      if (deed == "delete and add") {
        delete self.c;
        self.c = "again";
      }
      if (deed == "freeze") Object.freeze(self);
      if (deed == "store") self.c = "stored";
      if (deed == "copy") show("inner", { ...plain(n) });
      if (deed == "collect") Bun.gc(true);
      if (deed == "throw") throw new Error("from b");
      return n + 1;
    },
    c: n * 2,
    get d() {
      calls.push("d");
      return 7;
    },
  };
  Object.defineProperty(made, "hidden", { value: "h", enumerable: false, configurable: true, writable: true });
  return made;
}

const deeds = ["", "", "delete", "", "add", "hide", "unhide", "other getter", "delete and add", "freeze", "store", "copy", "collect", "throw", ""];
for (deed of deeds) {
  try {
    show(deed, { ...moving(1) });
    const { a, ...rest } = moving(2);
    show(deed + ", rest", rest);
  } catch (error) {
    show(String(error), {});
  }
}

const mark = Symbol("mark");

function wide(n: number, late?: string) {
  return {
    [mark]: n,
    p0: n,
    p1: undefined,
    p2: late,
    get p3() {
      calls.push("p3");
      return n;
    },
    p4: 4,
    p5: 5,
    p6: 6,
    p7: 7,
    p8: 8,
    get [Symbol.toStringTag]() {
      calls.push("tag");
      return "Wide";
    },
  };
}

for (let i = 0; i < 3; i++) {
  show("wide", { ...wide(i, i == 1 ? "late" : undefined) });
  show("wide and more", { ...wide(i), more: i });
}

function grown(n: number, name: string) {
  const made: Record<string, unknown> = {
    a: n,
    get b() {
      calls.push("b");
      return n;
    },
  };
  made[name] = n;
  Object.defineProperty(made, name + "Getter", {
    get() {
      calls.push(name);
      return n;
    },
    enumerable: true,
    configurable: true,
  });
  return made;
}

for (let i = 0; i < 4; i++) show("grown", { ...grown(i, "x" + (i & 1)) });

function named(n: number) {
  return {
    ["__proto__"]: n,
    get g() {
      calls.push("g");
      return n;
    },
  };
}

for (let i = 0; i < 2; i++) {
  const copy = { ...named(i) };
  show("__proto__", copy);
  console.log(Object.getPrototypeOf(copy) === Object.prototype);
}
