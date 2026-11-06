// Static fields that are written without a value are read before their first store, between the stores and after them: `accessor` fields, private names and ordinary names, with a type and without one, in classes at the top level and in classes that a function makes.
function show(label: string, values: unknown[]) {
  console.log(label + ": " + values.map(value => `${typeof value} ${String(value)}`).join(", "));
}
function attempt<T>(read: () => T): T | string {
  try {
    return read();
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

class Inferred {
  static look() {
    return [attempt(() => Inferred.x), attempt(() => Inferred.y), attempt(() => Inferred.z)];
  }
  static accessor x;
  static first = Inferred.look();
  static {
    this.x = 1;
  }
  static accessor y = this.x;
  static accessor z;
  static second = Inferred.look();
  static {
    this.z = this.y;
  }
}
show("inferred at first", Inferred.first);
show("inferred then", Inferred.second);
show("inferred at last", Inferred.look());

class Typed {
  static look() {
    return [
      Typed.n,
      Typed.b,
      Typed.s,
      Typed.big,
      typeof Typed.n,
      typeof Typed.b,
      Typed.n + 1,
      Typed.n | 0,
      Typed.n === undefined,
      !Typed.b,
      Typed.b ? "yes" : "no",
      `${Typed.n} ${Typed.b} ${Typed.s}`,
    ];
  }
  static accessor n: number;
  static accessor b: boolean;
  static accessor s: string;
  static accessor big: bigint;
  static first = Typed.look();
  static {
    this.n = 2;
    this.b = true;
    this.s = "text";
    this.big = 3n;
  }
}
show("typed at first", Typed.first);
show("typed at last", Typed.look());
Typed.n += 0.5;
Typed.b = false;
show("typed from outside", Typed.look());

class Private {
  static look() {
    return [
      Private.#n,
      Private.#b,
      Private.#a,
      Private.#inferred,
      typeof Private.#n,
      typeof Private.#b,
      typeof Private.#a,
      Private.#n + 1,
      Private.#a | 0,
      Private.#n === undefined,
      !Private.#b,
    ];
  }
  static #n: number;
  static #b: boolean;
  static accessor #a: number;
  static #inferred;
  static first = Private.look();
  static {
    this.#n = 4;
    this.#b = true;
    this.#a = 5;
    this.#inferred = "stored";
  }
}
show("private at first", Private.first);
show("private at last", Private.look());

class Ordinary {
  static look() {
    return [Ordinary.n, Ordinary.b, typeof Ordinary.n, Ordinary.n + 1, !Ordinary.b, Object.keys(Ordinary).join()];
  }
  static n: number;
  static b: boolean;
  static first = Ordinary.look();
  static {
    this.n = 6;
    this.b = true;
  }
}
show("ordinary at first", Ordinary.first);
show("ordinary at last", Ordinary.look());

class Never {
  static look() {
    return [
      Never.n,
      Never.#p,
      Never.#a,
      typeof Never.n,
      typeof Never.#p,
      typeof Never.#a,
      Never.n + 1,
      !Never.#p,
      Never.plain,
      Never.plain * 2,
    ];
  }
  static accessor n: number;
  static #p: boolean;
  static accessor #a: bigint;
  static plain: number;
}
show("never stored", Never.look());

function make(start: number) {
  return class Made {
    static look() {
      return [Made.n, Made.#p, typeof Made.n, typeof Made.#p, Made.n + start, Made.#p + start];
    }
    static add(by: number) {
      Made.n += by;
      Made.#p += by;
      return Made.look();
    }
    static accessor n: number;
    static #p: number;
    static first = Made.look();
    static {
      this.n = start;
      this.#p = start * 2;
    }
  };
}
const [one, ten] = [make(1), make(10)];
show("made at first", [...one.first, ...ten.first]);
show("made and added to", [...one.add(1), ...ten.add(2)]);
show("made at last", [...one.look(), ...ten.look()]);

class Below extends Typed {
  static stored = attempt(() => (Below.n = 9));
  static read = attempt(() => Below.n);
}
show("through a class below", [Below.stored, Below.read, Typed.n]);

function doubled(
  target: ClassAccessorDecoratorTarget<typeof Decorated, number>,
  _context: ClassAccessorDecoratorContext<typeof Decorated, number>,
): ClassAccessorDecoratorResult<typeof Decorated, number> {
  return {
    get() {
      return target.get.call(this) * 2;
    },
    init(value) {
      console.log("the first value is", value);
      return value;
    },
  };
}
class Decorated {
  static look() {
    return [Decorated.n, typeof Decorated.n];
  }
  @doubled static accessor n: number;
  static first = Decorated.look();
  static {
    this.n = 8;
  }
}
show("decorated at first", Decorated.first);
show("decorated at last", Decorated.look());
