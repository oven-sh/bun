// Prints the places in the stack traces of errors that ordinary typed code throws, written over several lines.
const places = (error: unknown): string =>
  String((error as Error).stack)
    .split("\n")
    .filter(line => /stack-positions-in-typed-code-written-over-several-lines\.ts/.test(line))
    .map(line => line.trim().replace(/\(?\S*stack-positions-in-typed-code-written-over-several-lines\.ts:/, "").replace(/\)$/, ""))
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
