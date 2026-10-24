// `Bun.inspect` and `console.log` list the members of a class prototype from which nothing has been read: methods and accessors are there, in sorted order where that is asked for, and `constructor` is left out.
class Sorted {
  zeta(): number {
    return 1;
  }
  alpha(): string {
    return "a";
  }
  get size(): number {
    return 2;
  }
  set size(value: number) {}
  get readOnly(): number {
    return 3;
  }
  async later(): Promise<void> {}
  *each(): Generator<number> {}
  [Symbol.iterator](): Iterator<number> {
    return [][Symbol.iterator]();
  }
  static create(): Sorted {
    return new Sorted();
  }
}
console.log(Bun.inspect(Sorted.prototype, { sorted: true }));

class Unsorted {
  zeta(): void {}
  alpha(): void {}
}
console.log(Bun.inspect(Unsorted.prototype));

class Logged {
  zeta(): void {}
  alpha(): void {}
}
console.log(Logged.prototype);

class Nested {
  zeta(): void {}
  alpha(): void {}
}
console.log(Bun.inspect({ holder: Nested.prototype, list: [Nested.prototype] }, { sorted: true }));

class Base {
  inherited(): void {}
}
class Derived extends Base {
  own(): void {}
}
console.log(Bun.inspect(Derived.prototype, { sorted: true }), Bun.inspect(Object.getPrototypeOf(Derived.prototype), { sorted: true }));

class Empty {}
console.log(Bun.inspect(Empty.prototype, { sorted: true }), Bun.inspect(new Empty(), { sorted: true }));

class WithFields {
  field = 1;
  method(): number {
    return this.field;
  }
}
console.log(Bun.inspect(new WithFields(), { sorted: true }), Bun.inspect(WithFields.prototype, { sorted: true }));

class ReadFirst {
  zeta(): number {
    return 1;
  }
  alpha(): number {
    return 2;
  }
}
console.log(new ReadFirst().zeta(), Bun.inspect(ReadFirst.prototype, { sorted: true }));

class Statics {
  static zeta(): void {}
  static alpha = 1;
  static get size(): number {
    return 2;
  }
}
console.log(Bun.inspect(Statics, { sorted: true }), Bun.inspect({ ...Statics }, { sorted: true }));
export {};
