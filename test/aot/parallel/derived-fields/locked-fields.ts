// @ts-nocheck
// Where a definition behind super() throws, the fields in front of it hold undefined or what they are initialized with, never what the constructor would have stored.
const all: any[] = [];
const pool: any[] = [];
class Locks {
  constructor(id: number) {
    Object.defineProperty(this, "id", { value: id });
    all.push(this);
  }
}
class User extends Locks {
  name: string;
  id: number;
  constructor(id: number, name: string) {
    super(id);
    this.name = name;
  }
}
class Account extends Locks {
  id: number;
  constructor(
    id: number,
    readonly name: string,
  ) {
    super(id);
  }
}
class Pooled {
  constructor() {
    const old = pool.pop();
    if (old) return old;
  }
}
class Job extends Pooled {
  a = 1;
  b = 2;
  constructor(a: number, b: number) {
    super();
    this.a = a;
    this.b = b;
  }
}
class Gone extends Pooled {
  a: number;
  b: number;
  constructor(a: number, b: number) {
    super();
    this.a = a;
    this.b = b;
  }
}
class Free extends Pooled {
  a: number;
  b: number;
  constructor(
    a: number,
    b: number,
    readonly c: string,
  ) {
    super();
    this.a = a;
    this.b = b;
  }
}
const attempt = (make: () => unknown) => {
  try {
    make();
    return "made";
  } catch (error: any) {
    return error.constructor.name;
  }
};
for (let turn = 0; turn < 3; turn++) {
  all.length = 0;
  console.log(attempt(() => new User(1, "ann")), all[0].name, Object.keys(all[0]).join());
  console.log(attempt(() => new Account(1, "ann")), all[1].name, Object.keys(all[1]).join());
  const job = new Job(3, 4);
  Object.defineProperty(job, "b", { value: 9, writable: false, configurable: false });
  pool.push(job);
  console.log(attempt(() => new Job(5, 6)), job.a, job.a + 1, job.b);
  const gone = new Gone(3, 4);
  delete (gone as any).b;
  Object.preventExtensions(gone);
  pool.push(gone);
  console.log(attempt(() => new Gone(5, 6)), gone.a, gone.b, Object.keys(gone).join());
  const free = new Free(1, 2, "first");
  pool.push(free);
  console.log(attempt(() => new Free(3, 4, "second")), free.a + free.b, free.c, Object.keys(free).join());
}
