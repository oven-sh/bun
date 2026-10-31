// Reflect define property writes to a member of a prototype a class or a function right before the typed uses.
function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + nameOf(error));
  }
}

class C1 {
  level = 1;
  value(): number {
    return this.level;
  }
}

function ask1(o: C1): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value;
}

function block1(): void {
  const o = new C1();
  Reflect.defineProperty(C1.prototype, "value", { value: undefined });
  attempt("a method of a prototype becomes undefined, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
  attempt("a method of a prototype becomes undefined, asked by a typed function", () => ask1(o));
  attempt("a method of a prototype becomes undefined, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("a method of a prototype becomes undefined, used", () => o.value());
  attempt("a method of a prototype becomes undefined, on a new instance", () => new C1().value());
  attempt("a method of a prototype becomes undefined, listed", () => Object.hasOwn(o, "value") + " " + Object.getOwnPropertyNames(C1.prototype).join());
  attempt("a method of a prototype becomes undefined, a typed store", () => (o.value = () => 2));
  attempt("a method of a prototype becomes undefined, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
}

block1();

class C2 {
  level = 1;
  value(): number {
    return this.level;
  }
}

function ask2(o: C2): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value;
}

function block2(): void {
  const o = new C2();
  Reflect.defineProperty(C2.prototype, "value", { value: 5 });
  attempt("a method of a prototype becomes a value of another kind, asked directly", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
  attempt("a method of a prototype becomes a value of another kind, asked by a typed function", () => ask2(o));
  attempt("a method of a prototype becomes a value of another kind, asked by a callback", () => [o].filter(q => q.value === undefined).length + " " + [o].filter(q => typeof q.value === "function").length);
  attempt("a method of a prototype becomes a value of another kind, used", () => o.value());
  attempt("a method of a prototype becomes a value of another kind, on a new instance", () => new C2().value());
  attempt("a method of a prototype becomes a value of another kind, listed", () => Object.hasOwn(o, "value") + " " + Object.getOwnPropertyNames(C2.prototype).join());
  attempt("a method of a prototype becomes a value of another kind, a typed store", () => (o.value = () => 2));
  attempt("a method of a prototype becomes a value of another kind, asked after the store", () => (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "function") + " " + typeof o.value);
}

block2();

class C3 {
  static value = 1;
  static twice(): number {
    return C3.value * 2;
  }
}

function ask3(o: typeof C3): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block3(): void {
  Reflect.defineProperty(C3, "value", { value: undefined });
  attempt("a static field becomes undefined, asked directly", () => (C3.value === undefined) + " " + (C3.value == null) + " " + (typeof C3.value === "number") + " " + typeof C3.value);
  attempt("a static field becomes undefined, asked by a typed function", () => ask3(C3));
  attempt("a static field becomes undefined, asked by a callback", () => [C3].filter(q => q.value === undefined).length + " " + [C3].filter(q => typeof q.value === "number").length);
  attempt("a static field becomes undefined, used", () => C3.value + 1);
  attempt("a static field becomes undefined, by a static method", () => C3.twice());
  attempt("a static field becomes undefined, listed", () => Object.keys(C3).join());
  attempt("a static field becomes undefined, a typed store", () => (C3.value = 5));
  attempt("a static field becomes undefined, asked after the store", () => (C3.value === undefined) + " " + (C3.value == null) + " " + (typeof C3.value === "number") + " " + typeof C3.value);
}

block3();

class C4 {
  static value = 1;
  static twice(): number {
    return C4.value * 2;
  }
}

function ask4(o: typeof C4): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block4(): void {
  Reflect.defineProperty(C4, "value", { value: "text" });
  attempt("a static field becomes a value of another kind, asked directly", () => (C4.value === undefined) + " " + (C4.value == null) + " " + (typeof C4.value === "number") + " " + typeof C4.value);
  attempt("a static field becomes a value of another kind, asked by a typed function", () => ask4(C4));
  attempt("a static field becomes a value of another kind, asked by a callback", () => [C4].filter(q => q.value === undefined).length + " " + [C4].filter(q => typeof q.value === "number").length);
  attempt("a static field becomes a value of another kind, used", () => C4.value + 1);
  attempt("a static field becomes a value of another kind, by a static method", () => C4.twice());
  attempt("a static field becomes a value of another kind, listed", () => Object.keys(C4).join());
  attempt("a static field becomes a value of another kind, a typed store", () => (C4.value = 5));
  attempt("a static field becomes a value of another kind, asked after the store", () => (C4.value === undefined) + " " + (C4.value == null) + " " + (typeof C4.value === "number") + " " + typeof C4.value);
}

block4();

function ask5(o: { value: number }): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block5(): void {
  const f = Object.assign((n: number): number => n * 2, { value: 1 });
  Reflect.defineProperty(f, "value", { value: undefined });
  attempt("a member of a function becomes undefined, asked directly", () => (f.value === undefined) + " " + (f.value == null) + " " + (typeof f.value === "number") + " " + typeof f.value);
  attempt("a member of a function becomes undefined, asked by a typed function", () => ask5(f));
  attempt("a member of a function becomes undefined, asked by a callback", () => [f].filter(q => q.value === undefined).length + " " + [f].filter(q => typeof q.value === "number").length);
  attempt("a member of a function becomes undefined, used", () => f.value + 1);
  attempt("a member of a function becomes undefined, called", () => f(2));
  attempt("a member of a function becomes undefined, listed", () => Object.keys(f).join());
  attempt("a member of a function becomes undefined, a typed store", () => (f.value = 5));
  attempt("a member of a function becomes undefined, asked after the store", () => (f.value === undefined) + " " + (f.value == null) + " " + (typeof f.value === "number") + " " + typeof f.value);
}

block5();

function ask6(o: { value: number }): string {
  return (o.value === undefined) + " " + (o.value == null) + " " + (typeof o.value === "number") + " " + typeof o.value;
}

function block6(): void {
  const f = Object.assign((n: number): number => n * 2, { value: 1 });
  Reflect.defineProperty(f, "value", { value: "text" });
  attempt("a member of a function becomes a value of another kind, asked directly", () => (f.value === undefined) + " " + (f.value == null) + " " + (typeof f.value === "number") + " " + typeof f.value);
  attempt("a member of a function becomes a value of another kind, asked by a typed function", () => ask6(f));
  attempt("a member of a function becomes a value of another kind, asked by a callback", () => [f].filter(q => q.value === undefined).length + " " + [f].filter(q => typeof q.value === "number").length);
  attempt("a member of a function becomes a value of another kind, used", () => f.value + 1);
  attempt("a member of a function becomes a value of another kind, called", () => f(2));
  attempt("a member of a function becomes a value of another kind, listed", () => Object.keys(f).join());
  attempt("a member of a function becomes a value of another kind, a typed store", () => (f.value = 5));
  attempt("a member of a function becomes a value of another kind, asked after the store", () => (f.value === undefined) + " " + (f.value == null) + " " + (typeof f.value === "number") + " " + typeof f.value);
}

block6();

export {};
