// A definition in a field initializer throws after an earlier field was defined: what the earlier field holds afterwards.
const seen: string[] = [];
function note(label: string, value: unknown): void {
  seen.push(label + ": " + (value === undefined ? "undefined" : String(value)));
}
function attempt(label: string, run: () => unknown): void {
  try {
    note(label, run());
  } catch (error) {
    note(label, "throws " + (error as Error).constructor.name);
  }
}

// 1. The base constructor answers an object that takes no new property.
const closed: any = Object.preventExtensions({ a: 1 });
class AnswersClosed {
  constructor() {
    return closed;
  }
}
class OnClosed extends AnswersClosed {
  a: number;
  b: number;
  constructor() {
    super();
    this.a = 1;
    this.b = 2;
  }
}
attempt("1 construction", () => new OnClosed());
note("1 closed.a", closed.a);

// 2. The base constructor closes `this` itself, and keeps it.
let keptClosed: any;
class ClosesItself {
  constructor() {
    (this as any).a = 9;
    Object.preventExtensions(this);
    keptClosed = this;
  }
}
class OnItself extends ClosesItself {
  a: number;
  b: number;
  constructor() {
    super();
    this.a = 1;
    this.b = 2;
  }
}
attempt("2 construction", () => new OnItself());
note("2 keptClosed.a", keptClosed.a);

// 3. The base constructor answers the same instance twice: the private field is there already.
let kept: any;
class AnswersKept {
  constructor() {
    if (kept) return kept;
    kept = this;
  }
}
class Twice extends AnswersKept {
  n: number;
  #p: number = 1;
  constructor() {
    super();
    this.n = 5;
  }
  p() {
    return this.#p;
  }
}
attempt("3 first", () => new Twice().n);
attempt("3 second", () => new Twice().n);
note("3 kept.n", kept.n);

// 4. The same with the private field in front: nothing is defined before the error.
let keptBehind: any;
class AnswersKeptBehind {
  constructor() {
    if (keptBehind) return keptBehind;
    keptBehind = this;
  }
}
class TwiceBehind extends AnswersKeptBehind {
  #p: number = 1;
  n: number;
  constructor() {
    super();
    this.n = 5;
  }
  p() {
    return this.#p;
  }
}
attempt("4 first", () => new TwiceBehind().n);
attempt("4 second", () => new TwiceBehind().n);
note("4 keptBehind.n", keptBehind.n);

// 5. A proxy: the trap of the second definition looks at the first field.
let target: any;
class AnswersProxy {
  constructor() {
    target = {};
    return new Proxy(target, {
      defineProperty(object, key, descriptor) {
        note("5 trap " + String(key) + " sees a", object.a);
        return Reflect.defineProperty(object, key, descriptor);
      },
    });
  }
}
class OnProxy extends AnswersProxy {
  a: number;
  b: number;
  constructor() {
    super();
    this.a = 1;
    this.b = 2;
  }
}
attempt("5 construction", () => new OnProxy().b);
console.log(seen.join("\n"));
