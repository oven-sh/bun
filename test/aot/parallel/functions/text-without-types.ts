// String(f) of a function in a .ts file is its source without the types. Where a type, a type's statement or a member without code kept two things apart, or held a line together,
// the text would mean something else with it merely gone, or would not parse.
// Plain Bun prints what its transpiler wrote, so the texts are not compared: each is evaluated, and has to do what the function does.
const key = "k";
const functions = [
  function (a: unknown) {
    return <number>
      a;
  },
  function (a: unknown) {
    try {
      throw <number> // why
        a;
    } catch (e) { return e; }
  },
  function (a: unknown) {
    function* g() {
      yield<number>
        a;
    }
    return [...g()];
  },
  function (a: number) {
    const g = async <T,>
      (x: T) => x;
    return typeof g(a);
  },
  function (a: number) {
    let x = a
    type T = number;
    [x].length
    return x
  },
  function (a: number) {
    let x = a
    interface I { p: number }
    (x)
    return x
  },
  function (a: number) {
    let x = a
    type U = string
    `${x}`
    return x
  },
  function (a: number) {
    let x = a as number
    (x)
    return x
  },
  function (a: number) {
    let x = [a] as const
    [x]
    return x
  },
  function (a: number) {
    let x = a satisfies number
    `${x}`
    return x
  },
  function (a: number) {
    let x = <object>{ a } as { a: number }
    (a)
    return x
  },
  function (a: number) {
    return "1" as string in [a, a];
  },
  function (a: number) {
    class K {
      static?: number
      x = a
    }
    return new K().x;
  },
  function (a: number) {
    class K {
      get?: number
      x = a
    }
    return new K().x;
  },
  function (a: number) {
    class K {
      public set!: number
      x = a
    }
    return new K().x;
  },
  function (a: number) {
    class K {
      x = a
      declare y: number
      [key] = 2
    }
    return JSON.stringify(new K());
  },
  function (a: number) {
    abstract class K {
      x = a
      abstract w: number
      in = 3
    }
    return JSON.stringify(new (K as any)());
  },
  function (a: number) {
    class K {
      x = a
      declare y: number
      *[Symbol.iterator]() { yield this.x; }
    }
    return [...new K()];
  },
  function (a: number) /* see /* above */ : number {
    return a;
  },
  function (a: number) {
    const quote = /"/; function g() // the rest
      : string { return String(a).replace(quote, ""); }
    return g();
  },
  function (a: number) {
    const slashes = /[//]/; function g()
      : string { return String(a).replace(slashes, ""); }
    return g();
  },
  function (a: number) {
    const page = `
// ${a}`; function g()
      : string { return page; }
    return g();
  },
  function (a: number) {
    const quoted = '// "'; function g() /* ' */ // "
      : string { return quoted + a; }
    return g();
  },
];
for (const made of functions) {
  let second: string;
  try {
    second = JSON.stringify(new Function("key", "return (" + String(made) + "\n)")(key)(1)) ?? "undefined";
  } catch (error) {
    second = (error as Error).name;
  }
  console.log(JSON.stringify((made as any)(1)), second);
}
export {};
