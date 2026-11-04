// RUN: lower
// OPTIONS: builtin-modules

// Prints the places in the stack traces of errors that ordinary typed code throws, written over several lines.
const places = (error: unknown): string =>
  String((error as Error).stack)
    .split("\n")
    .filter(line => /stack-positions-typed-code-written\.ts/.test(line))
    .map(line => line.trim().replace(/\(?\S*stack-positions-typed-code-written\.ts:/, "").replace(/\)$/, ""))
    .join(" < ");
let count = 0;
function show(run: () => unknown): void {
  count++;
  try {
    run();
    console.log(count, "no error");
  } catch (error) {
    console.log(count, (error as Error).constructor.name, places(error));
  }
}
function fail(message: string = "fail"): never {
  throw new Error(message);
}
interface Options {
  port?: number;
  nested?: { deep?: { value: number } };
}
type Handler<T> = (value: T) => void;
enum Color {
  Red,
  Green = fail.length,
  Blue = "blue".length,
}
namespace Tools {
  export function broken(): never {
    return fail("tools");
  }
  export const size: number = 1;
}
abstract class Shape {
  constructor(
    public readonly name: string,
    protected options: Options = {},
  ) {
    this.check();
  }
  abstract area(): number;
  check(): void {}
}
class Square extends Shape {
  private side!: number;
  declare hidden: string;
  override check(): void {
    if (this.name === "bad") {
      fail("bad square");
    }
  }
  area(): number {
    return this.options.nested!.deep!.value * this.side;
  }
  each<T>(items: T[], handler: Handler<T>): void {
    for (const item of items) {
      handler(item);
    }
  }
}
const options: Options = {};
const anything: any = undefined;
show(() => new Square("bad"));
show(() => new Square("good").area());
show(() => {
  new Square("good").each<number>([1, 2], (value: number): void => {
    if (value === 2) fail("two");
  });
});
show(() => Tools.broken());
show(() => (options as Required<Options>).nested.deep!.value);
show(() => options.nested!.deep);
show(() => (<any>options).nested.deep);
show(() => (anything satisfies any).x);
show(() => anything!.x!.y);
show(() => {
  const value: number = anything.count;
  return value;
});
show(() => {
  const handler: Handler<string> = anything;
  handler("x");
});
show(() => {
  function generic<T extends object>(input: T, key: keyof T): T[keyof T] {
    return (input[key] as any).missing.deep;
  }
  return generic<{ a: number }>({ a: 1 }, "a");
});
show(() => {
  (function (): void {
    fail("ends with an interface");
    interface Local {
      a: number;
    }
  })();
});
show(() => {
  (function (): void {
    fail("ends with a type");
    type Local = number;
  })();
});
show(() => {
  (function (): void {
    fail("ends with an enum");
    enum Local {
      A,
      B,
    }
  })();
});
show(() => {
  (function (this: void, first?: number): { a: number } | void {})(fail("argument"));
});
show(() => {
  ((input: { x: number } | null): void => {
    const { x }: { x: number } = input!;
  })(null);
});
show(() => {
  (function ({ x }: { x: number }): (void) {
  } as any)(null);
});
show(() => {
  const once: { valueOf(): number } = { valueOf: fail as any };
  return (once as any) + 1;
});
show(() => {
  const list = [1, 2, 3] as const;
  return (list as any)[5].toFixed();
});
show(() => Color[anything.index]);
show(() => {
  class Box<T> {
    constructor(private value: T) {}
    get(): T {
      return (this.value as any).inner.deep;
    }
  }
  return new Box<number>(1).get();
});
show(() => {
  for (const [key, value] of Object.entries(anything as Record<string, number>)) {
    count += 0 * value * key.length;
  }
});
show(() => {
  (function (): void {
    fail("ends with a constant enum");
    const enum Local {
      A,
    }
  })();
});
show(() => {
  (function (): void {
    fail("ends with an empty enum");
    enum Local {}
  })();
});

// GENERATED: fail Square area each Box
// CHECK-LABEL: function {{*}}name="fail"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = String string="fail"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b3(v4)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3(v5)
// CHECK-NEXT: b3(v6):
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="Error" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v10 = Construct v9, -, v6 calleeName="Error"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Throw v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Square"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_2]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_3]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="area"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_2]]} results=[{type=number}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: [[L_2]]):
// CHECK-NEXT: v1 = PropGet v0 key="options"
// CHECK-NEXT: v2 = PropGet v1 key="nested"
// CHECK-NEXT: v3 = PropGet v2 key="deep"
// CHECK-NEXT: v4 = PropGet v3 key="value"
// CHECK-NEXT: v5 = PropGet v0 key="side"
// CHECK-NEXT: v6 = Mul v4, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=number}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="each"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: undefined|null|[[f_5]]):
// CHECK-NEXT: v2 = IteratorOpen v0
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v4 = IteratorResume v2
// CHECK-NEXT: v5 = ResultAt v4
// CHECK-NEXT: v6 = ResultAt v4 index=1
// CHECK-NEXT: Branch v5 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: v8 = Call v1, -, v6 calleeName="handler"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b5() role=IterationCleanup subject=v2:
// CHECK-NEXT: v9 = CatchException
// CHECK-NEXT: IteratorClose v2 completion=Throw
// CHECK-NEXT: Rethrow v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Box"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_6]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_6]]}
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_7]]
// CHECK-NEXT: PropSet v4, v1 key="value"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b1(| 0), notTaken b2(v4)
// CHECK-NEXT: b1(v9):
// CHECK-NEXT: Jump -> next b2(v9)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
