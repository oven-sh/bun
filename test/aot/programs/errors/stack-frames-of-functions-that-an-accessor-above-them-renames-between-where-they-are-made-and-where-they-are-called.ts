// A function makes a function object, reads or stores a member of it, and calls it. The member is an accessor: on Function.prototype under a symbol or a name that may be added there, or on an object that the function object gets as its prototype. The accessor keeps its receiver, or renames it on the spot. Each function object is made three times: renamed, left alone, renamed otherwise. Prints what the frames call each of them.
type Made = Function & { displayName?: string };
let kept: Made;
let next = "";
const keeps = Symbol("keeps");
const renames = Symbol("renames");
function frames(error: unknown): string {
  return (error as Error)
    .stack!.split("\n")
    .slice(1, 3)
    .map(line => line.trim().split(" ")[1])
    .join(" < ");
}
function rename(made: Function, name: string): void {
  if (name) Object.defineProperty(made, "name", { value: name });
}
function run(outer: (name: string) => void): void {
  for (const name of ["first", "", "second"]) {
    try {
      outer(name);
    } catch (error) {
      console.log(frames(error));
    }
  }
}
const keepsReceiver = {
  get(this: Made) {
    kept = this;
    return 1;
  },
  set(this: Made, value: number) {
    kept = this;
  },
  configurable: true,
};
Object.defineProperty(Function.prototype, keeps, keepsReceiver);
Object.defineProperty(Function.prototype, "unThis", keepsReceiver);
Object.defineProperty(Function.prototype, renames, {
  get(this: Made) {
    rename(this, next);
    return 1;
  },
  set(this: Made, value: number) {
    if (next) this.displayName = next;
  },
  configurable: true,
});
const above = Object.defineProperty(Object.create(Function.prototype), "tag", keepsReceiver);
const names = ["unThis"];

run(function readsUnderSymbol(name) {
  const made: any = function written1() {
    throw new Error("x");
  };
  made[keeps];
  rename(kept, name);
  made();
});
run(function storesUnderSymbol(name) {
  const made: any = function written2() {
    throw new Error("x");
  };
  made[keeps] = 1;
  rename(kept, name);
  made();
});
run(function addsUnderSymbol(name) {
  const made: any = function written3() {
    throw new Error("x");
  };
  made[keeps]++;
  if (name) kept.displayName = name;
  made();
});
run(function takesApart(name) {
  const made: any = function written4() {
    throw new Error("x");
  };
  const { [keeps]: one, unThis } = made;
  rename(kept, name);
  made();
});
run(function readsByName(name) {
  const made: any = function written5() {
    throw new Error("x");
  };
  made.unThis;
  rename(kept, name);
  made();
});
run(function storesByName(name) {
  const made: any = function written6() {
    throw new Error("x");
  };
  made.unThis = 1;
  rename(kept, name);
  made();
});
run(function readsUnderKey(name) {
  const made: any = function written7() {
    throw new Error("x");
  };
  made[names[0]];
  rename(kept, name);
  made();
});
run(function storesUnderKey(name) {
  const made: any = function written8() {
    throw new Error("x");
  };
  made[names[0]] = 2;
  rename(kept, name);
  made();
});
run(function readsWhatRenames(name) {
  const made: any = function written9() {
    throw new Error("x");
  };
  next = name;
  made[renames];
  made();
});
run(function storesWhatRenames(name) {
  const made: any = function written10() {
    throw new Error("x");
  };
  next = name;
  made[renames] = 1;
  made();
});
run(function readsBelowAnotherPrototype(name) {
  const made: any = function written11() {
    throw new Error("x");
  };
  made.__proto__ = above;
  made.tag;
  rename(kept, name);
  made();
});
run(function storesBelowAnotherPrototype(name) {
  const made: any = function written12() {
    throw new Error("x");
  };
  Object.setPrototypeOf(made, above);
  made.tag = 1;
  rename(kept, name);
  made();
});
run(function readsInAnArrow(name) {
  const made: any = () => {
    throw new Error("x");
  };
  made[keeps];
  rename(kept, name);
  made();
});
