// `bun run` moves a simple top-level class before the other statements of its file, so code above the declaration can use it. A class that extends, has a static block, a bracketed key or a static field whose value has to be computed stays where it is written, and using it above its declaration is a ReferenceError. A compiled program does the same. Every line prints what plain Bun prints.
function attempt(label: string, action: () => unknown): void {
  try {
    console.log(label, String(action()));
  } catch (error) {
    console.log(label, (error as Error).constructor.name);
  }
}
const key = "computed";
function make(): number {
  return 7;
}

attempt("a class without members", () => typeof new Empty());
attempt("a class with methods and fields", () => new Plain().describe());
attempt("a static field with a literal", () => WithLiteral.count);
attempt("a static field with a function", () => WithFunction.make());
attempt("a static field with a simple class", () => typeof new WithClass.Inner());
attempt("a class that extends", () => typeof new Derived());
attempt("a class with a static block", () => WithBlock.ready);
attempt("a class with a bracketed key", () => typeof new WithKey());
attempt("a static field with a call", () => WithCall.made);
attempt("a static field that reads a variable", () => WithRead.name2);
attempt("a class in a block is not moved", () => {
  const read = () => typeof Inner;
  const early = read();
  class Inner {}
  return early;
});

class Empty {}
class Plain {
  size = 2;
  describe(): string {
    return "plain " + this.size;
  }
}
class WithLiteral {
  static count = 3;
}
class WithFunction {
  static make = () => "made";
}
class WithClass {
  static Inner = class {};
}
class Derived extends Empty {}
class WithBlock {
  static ready = false;
  static {
    WithBlock.ready = true;
  }
}
class WithKey {
  [key]() {}
}
class WithCall {
  static made = make();
}
class WithRead {
  static name2 = key;
}

attempt("afterwards, a class that extends", () => typeof new Derived());
attempt("afterwards, a class with a static block", () => WithBlock.ready);
attempt("afterwards, a static field with a call", () => WithCall.made);
