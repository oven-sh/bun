// Classes below another have `accessor` fields and no ordinary field, and their constructors call `super()` inside a larger statement. Plain Bun prints another output.
const lines: string[] = [];
function note<T>(label: string, value: T): T {
  lines.push(label);
  return value;
}
function told(label: string) {
  return function (_value: unknown, context: DecoratorContext) {
    context.addInitializer(function () {
      lines.push("added by " + label);
    });
  };
}
const key = "computed";
class Above {
  above = note("above", "above");
}
class InADeclaration extends Above {
  accessor a = note("a", 1);
  constructor() {
    lines.push("ahead of super");
    const made: unknown = super();
    lines.push("behind super");
    console.log("in a declaration:", made === this, this.a, this.above);
  }
}
class TwoAccessors extends Above {
  accessor a = note("a", 1);
  accessor b = note("b", this.a + 1);
  constructor() {
    const made: unknown = super();
    console.log("two accessors:", made === this, this.a, this.b);
  }
}
class UnderAComputedKey extends Above {
  accessor a = note("a", 1);
  accessor [key] = note("computed", 4);
  constructor() {
    const made: unknown = super();
    console.log("under a computed key:", made === this, this.a, this[key]);
  }
}
class WithoutAValue extends Above {
  accessor a: number | undefined;
  constructor() {
    const made: unknown = super();
    console.log("without a value:", made === this, this.a);
  }
}
class AsAnArgument extends Above {
  accessor a = note("a", 1);
  constructor() {
    note("argument", super());
    console.log("as an argument:", this.a, this.above);
  }
}
class InABranch extends Above {
  accessor a = note("a", 1);
  constructor(early: boolean) {
    if (early) {
      super();
    } else {
      lines.push("late");
      super();
    }
    console.log("in a branch:", this.a, this.above);
  }
}
class Returned extends Above {
  accessor a = note("a", 1);
  constructor() {
    return super() as unknown as Returned;
  }
}
class StaticBeside extends Above {
  static accessor shared = note("shared", 3);
  accessor a = note("a", 1);
  constructor() {
    const made: unknown = super();
    console.log("a static accessor beside it:", made === this, this.a, StaticBeside.shared);
  }
}
class PrivateBeside extends Above {
  accessor a = note("a", 1);
  accessor #hidden = note("#hidden", 6);
  constructor() {
    const made: unknown = super();
    console.log("a private accessor beside it:", made === this, this.a, this.#hidden);
  }
}
class AsAStatement extends Above {
  accessor a = note("a", 1);
  constructor() {
    lines.push("ahead of super");
    super();
    lines.push("behind super");
    console.log("as a statement:", this.a, this.above);
  }
}
class CalledInOneBranch extends Above {
  accessor a = note("a", 1);
  constructor(call: boolean) {
    if (call) {
      super();
    }
    lines.push("behind the branch");
  }
}
class BehindADecoratedAccessor extends Above {
  @told("a") accessor a = note("a", 1);
  accessor b = note("b", 2);
  constructor() {
    const made: unknown = super();
    console.log("behind a decorated accessor:", made === this, this.a, this.b);
  }
}
class BesideADecoratedMethod extends Above {
  @told("method") method() {}
  accessor a = note("a", 1);
  constructor() {
    const made: unknown = super();
    console.log("beside a decorated method:", made === this, this.a);
  }
}
for (const run of [
  () => new InADeclaration(),
  () => new TwoAccessors(),
  () => new UnderAComputedKey(),
  () => new WithoutAValue(),
  () => new AsAnArgument(),
  () => new InABranch(true),
  () => new InABranch(false),
  () => new Returned(),
  () => new StaticBeside(),
  () => new PrivateBeside(),
  () => new AsAStatement(),
  () => new CalledInOneBranch(true),
  () => new CalledInOneBranch(false),
  () => new BehindADecoratedAccessor(),
  () => new BesideADecoratedMethod(),
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
in a declaration: true 1 above
ahead of super < above < a < behind super | 10 above
two accessors: true 1 2
above < a < b | 10 above
under a computed key: true 1 4
above < a < computed | 10 above
without a value: true undefined
above | 10 above
as an argument: 1 above
above < a < argument | 10 above
in a branch: 1 above
above < a | 10 above
in a branch: 1 above
late < above < a | 10 above
above < a | 10 above
a static accessor beside it: true 1 3
above < a | 10 above
a private accessor beside it: true 1 6
above < a < #hidden | 10 above
as a statement: 1 above
ahead of super < above < a < behind super | 10 above
above < a < behind the branch | 10 above
behind the branch | ReferenceError
behind a decorated accessor: true 1 2
above < a < added by a < b | 10 above
beside a decorated method: true 1
above < added by method < a | 10 above
*/
