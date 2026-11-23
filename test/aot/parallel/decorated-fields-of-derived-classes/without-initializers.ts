// A decorated field without an initializer, in a derived class whose constructor stores to fields or has parameter properties.
function keep(value: unknown, context: ClassFieldDecoratorContext) {}
function ten(value: unknown, context: ClassFieldDecoratorContext) {
  return (initial: any) => (initial ?? 0) + 10;
}

class Base {
  a = 1;
}

class ParameterProperty extends Base {
  constructor(public k: number) {
    super();
  }
  @keep u?: number;
}

class Stored extends Base {
  @ten u?: number;
  k: number;
  constructor(k: number) {
    super();
    this.k = k;
  }
}

class StoredOver extends Base {
  @ten u?: number;
  constructor(k: number) {
    super();
    this.u = k;
  }
}

class Private extends Base {
  @ten #u?: number;
  k: number;
  constructor(k: number) {
    super();
    this.k = k;
  }
  get u() {
    return this.#u;
  }
}

class Mixed extends Base {
  v?: number;
  @keep u?: number;
  w = 2;
  @ten x = 3;
  k: number;
  constructor(k: number) {
    super();
    this.k = k;
    this.v = k;
  }
}

function make(salt: number) {
  return class extends Base {
    @ten u?: number;
    constructor(public k: number) {
      super();
      console.log(salt, this.u, this.k);
    }
  };
}

for (let i = 0; i < 3; i++) {
  for (const made of [new ParameterProperty(i), new Stored(i), new StoredOver(i), new Private(i), new Mixed(i), new (make(i))(i)]) {
    console.log(JSON.stringify(made), Object.keys(made).join());
  }
  console.log(new Private(i).u);
}
