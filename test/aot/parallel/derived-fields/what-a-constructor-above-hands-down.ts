// @ts-nocheck
// A derived class defines its parameter properties and the fields that plain stores fill with their values. A proxy, another object or a frozen object from above still sees undefined first, then the store.
const seen: string[] = [];
const traps = {
  set(target: any, key: any, value: any) {
    seen.push("set " + String(key) + " " + value);
    target[key] = value;
    return true;
  },
  defineProperty(target: any, key: any, descriptor: any) {
    seen.push("define " + String(key) + " " + descriptor.value);
    return Reflect.defineProperty(target, key, descriptor);
  },
};
class Plain {}
class Watched {
  constructor() {
    return new Proxy(this, traps);
  }
}
class Other {
  constructor() {
    return {
      set name(value: unknown) {
        seen.push("setter " + value);
      },
    };
  }
}
class Frozen {
  constructor() {
    Object.freeze(this);
  }
}
class Fixed {
  constructor() {
    Object.defineProperty(this, "name", { value: "fixed", configurable: true });
  }
}
let last: any;
class Kept {
  constructor() {
    last = this;
  }
}
const look = () => {
  seen.push(Object.keys(last).join() + " " + last.name + " " + last.age + " " + last.sum);
  return 1;
};
const kinds = [
  class extends Plain {
    age: number;
    constructor(readonly name: string, age: number) {
      super();
      this.age = age;
    }
  },
  class extends Watched {
    age: number;
    constructor(readonly name: string, age: number) {
      super();
      this.age = age;
    }
  },
  class extends Other {
    age: number;
    constructor(readonly name: string, age: number) {
      super();
      this.age = age;
    }
  },
  class extends Frozen {
    age: number;
    constructor(readonly name: string, age: number) {
      super();
      this.age = age;
    }
  },
  class extends Fixed {
    age: number;
    constructor(readonly name: string, age: number) {
      super();
      this.age = age;
    }
  },
  class extends Kept {
    age: number;
    sum: number;
    late: number;
    constructor(readonly name: string, age: number) {
      super();
      this.age = age;
      this.sum = age + look();
      this.late = age;
    }
  },
];
for (const Kind of kinds) {
  seen.length = 0;
  try {
    const made: any = new Kind("ann", 3);
    console.log(Object.keys(made).join(), made.name, made.age, made.sum, made.late, "|", seen.join(", "));
  } catch (error: any) {
    console.log(error.constructor.name, "|", seen.join(", "));
  }
}
