// Classes below another have an `accessor` field and an ordinary field, and their constructors call `super()` inside a larger statement. Plain Bun prints another output.
const lines: string[] = [];
function note<T>(label: string, value: T): T {
  lines.push(label);
  return value;
}
class Above {
  above = note("above", "above");
}
class InADeclaration extends Above {
  f = note("f", 2);
  accessor a = note("a", 1);
  constructor() {
    lines.push("ahead of super");
    const made: unknown = super();
    lines.push("behind super");
    console.log("in a declaration:", made === this, this.a, this.f, this.above);
  }
}
class AccessorFirst extends Above {
  accessor a = note("a", 1);
  f = note("f", 2);
  constructor() {
    const made: unknown = super();
    console.log("the accessor first:", made === this, this.a, this.f, this.above);
  }
}
class AsAnArgument extends Above {
  f = note("f", 2);
  accessor a = note("a", 1);
  constructor() {
    note("argument", super());
    console.log("as an argument:", this.a, this.f, this.above);
  }
}
class InABranch extends Above {
  f = note("f", 2);
  accessor a = note("a", 1);
  constructor(early: boolean) {
    if (early) {
      super();
    } else {
      lines.push("late");
      super();
    }
    console.log("in a branch:", this.a, this.f, this.above);
  }
}
class StaticBeside extends Above {
  static accessor shared = note("shared", 3);
  f = note("f", 2);
  accessor a = note("a", 1);
  constructor() {
    const made: unknown = super();
    console.log("a static accessor beside them:", made === this, this.a, this.f, StaticBeside.shared);
  }
}
for (const run of [
  () => new InADeclaration(),
  () => new AccessorFirst(),
  () => new AsAnArgument(),
  () => new InABranch(true),
  () => new InABranch(false),
  () => new StaticBeside(),
]) {
  lines.length = 0;
  try {
    const made = run();
    made.a = 10;
    console.log(lines.join(" < "), "|", made.a, Object.keys(made).join());
  } catch (error: any) {
    console.log(lines.join(" < "), "|", error.constructor.name);
  }
}
/* Output:
in a declaration: true 1 2 above
ahead of super < above < f < a < behind super | 10 above,f
the accessor first: true 1 2 above
above < a < f | 10 above,f
as an argument: 1 2 above
above < f < a < argument | 10 above,f
in a branch: 1 2 above
above < f < a | 10 above,f
in a branch: 1 2 above
late < above < f < a | 10 above,f
a static accessor beside them: true 1 2 3
above < f < a | 10 above,f
*/
