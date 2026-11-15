export class Used {
  constructor(public size: number) {}
  double(): number {
    return this.size * 2;
  }
}

export class Unused {
  constructor(public size: number) {}
  triple(): number {
    return this.size * 3;
  }
}

export class Registered {
  static all: Registered[] = [Registered.create()];
  static create(): Registered {
    return new Registered();
  }
}
