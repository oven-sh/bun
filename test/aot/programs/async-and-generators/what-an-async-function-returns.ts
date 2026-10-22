// `return x` in an async function fulfills the promise with x, unless x is a promise or a thenable: then the promise takes what that one is fulfilled with.
// Every form in which a well-typed program returns one or the other.
interface User {
  id: number;
  name: string;
}
const tick = (): Promise<void> => Promise.resolve();

async function literal(n: number): Promise<User> {
  await tick();
  return { id: n, name: "literal" + n };
}
async function promise(n: number): Promise<User> {
  return literal(n);
}
async function awaited(n: number): Promise<User> {
  return await literal(n);
}
function makeThenable(n: number): PromiseLike<User> {
  return {
    then<A, B>(resolve?: ((value: User) => A | PromiseLike<A>) | null): PromiseLike<A | B> {
      return Promise.resolve(resolve!({ id: n, name: "thenable" + n }));
    },
  };
}
async function thenable(n: number): Promise<User> {
  return makeThenable(n);
}
async function either(n: number): Promise<User> {
  const value: User | Promise<User> = n % 2 ? literal(n) : { id: n, name: "either" + n };
  return value;
}
async function conditional(n: number): Promise<User> {
  return n % 2 ? literal(n) : { id: n, name: "conditional" + n };
}
async function generic<T>(value: T | PromiseLike<T>): Promise<T> {
  return value;
}
async function genericAlone<T>(value: T): Promise<Awaited<T>> {
  return value as Awaited<T>;
}
async function fromAny(value: any): Promise<User> {
  return value;
}
async function fromUnknown(value: unknown): Promise<unknown> {
  return value;
}
async function fromObject(value: object): Promise<object> {
  return value;
}
async function optional(n: number): Promise<User | undefined> {
  if (n > 5) return undefined;
  if (n > 3) return;
  return { id: n, name: "optional" + n };
}
async function count(n: number): Promise<number> {
  return n * 2;
}
async function text(n: number): Promise<string> {
  return n > 1 ? "many" : Promise.resolve("one");
}
async function nothing(): Promise<void> {}
class Store {
  constructor(public base: number) {}
  async make(n: number): Promise<User> {
    return { id: n + this.base, name: "store" + n };
  }
  async again(n: number): Promise<User> {
    return this.make(n);
  }
}
const arrow = async (n: number): Promise<User> => ({ id: n, name: "arrow" + n });
const arrowPromise = async (n: number): Promise<User> => literal(n);
async function inTry(n: number): Promise<User> {
  try {
    if (n > 2) throw new Error("over");
    return { id: n, name: "try" + n };
  } catch {
    return literal(n);
  } finally {
    await tick();
  }
}

const show = (user: User | undefined): string => (user === undefined ? "none" : user.id + ":" + user.name);
const n = process.argv.length;
const store = new Store(10);
console.log(show(await literal(n)), show(await promise(n)), show(await awaited(n)), show(await thenable(n)));
console.log(show(await either(n)), show(await either(n + 1)), show(await conditional(n)), show(await conditional(n + 1)));
console.log(show(await generic<User>(literal(n))), show(await generic<User>({ id: n, name: "given" })), show(await generic<User>(makeThenable(n))));
console.log(show(await genericAlone(literal(n))), show(await genericAlone<User>({ id: n, name: "alone" })), await genericAlone(n));
console.log(show(await fromAny(literal(n))), show(await fromAny({ id: n, name: "any" })), show(await fromAny(makeThenable(n))));
console.log(show((await fromUnknown(literal(n))) as User), await fromUnknown(n), show((await fromObject(literal(n))) as User), show((await fromObject(makeThenable(n))) as User));
console.log(show(await optional(n)), show(await optional(n + 2)), show(await optional(n + 4)));
console.log((await count(n)) + 1, await text(n), await text(n - 1), await nothing());
console.log(show(await store.make(n)), show(await store.again(n)), show(await arrow(n)), show(await arrowPromise(n)));
console.log(show(await inTry(n)), show(await inTry(n + 1)));

// What comes through `any` need not be what the type says, neither at once nor once a promise or a thenable has settled.
const describe = (value: unknown): string => typeof value + ":" + String(value);
const number: User = await fromAny(Promise.resolve(42));
const string: User = await fromAny({
  then(resolve: (value: unknown) => void) {
    resolve("text");
  },
});
const plain: User = await fromAny(7);
console.log(describe(number), describe(string), describe(plain));
const inGeneric: User = await generic<User>(Promise.resolve<any>(true));
const inObject: object = await fromObject(Promise.resolve<any>(null));
console.log(describe(inGeneric), describe(inObject));
