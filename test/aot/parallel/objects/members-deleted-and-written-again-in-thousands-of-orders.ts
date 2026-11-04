// COUNT: counter:KeyOrdersStoredOutOfLine >= 7000
// COUNT: counter:CompiledStructuresMade <= 52000
// COUNT: operation:operationAOTPutByValAndCache <= 60000
type Ten = { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number; g?: number; h?: number; i?: number; j?: number };
type Name = keyof Ten;
const letters: Name[] = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
function order(number: number): Name[] {
  const left = [...letters];
  const out: Name[] = [];
  for (let size = left.length; size > 0; size--) {
    out.push(left.splice(number % size, 1)[0]);
    number = Math.floor(number / size);
  }
  return out;
}
const full = (): Ten => ({ a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7, i: 8, j: 9 });
function writtenAgain(names: Name[], seed: number): Ten {
  const made = full();
  for (const name of names) {
    delete made[name];
    made[name] = seed + name.charCodeAt(0);
  }
  return made;
}
function hash(text: string, into: number): number {
  for (let i = 0; i < text.length; i++) into = (Math.imul(into, 31) + text.charCodeAt(i)) | 0;
  return into;
}
function sumOf(list: object[]): number {
  let sum = 0;
  for (const value of list) sum = hash(JSON.stringify(value), sum);
  return sum;
}
const show = (...values: unknown[]) => console.log(JSON.stringify(values));

const count = 12000;
const list: Ten[] = [];
for (let at = 0; at < count; at++) list.push(writtenAgain(order(at * 3), at));
console.log(sumOf(list), sumOf(list.map(value => Object.keys(value))), sumOf(list.map(value => Reflect.ownKeys(value))));
let inLoop = 0;
for (const value of list) for (const key in value) inLoop = hash(key, inLoop);
console.log(inLoop);

const last = count - 1;
const typed = list.map((value): Ten => ({ ...value }));
const untyped = list.map((value: any) => ({ ...value }));
console.log(sumOf(typed), sumOf(untyped), sumOf(list.map(value => Object.assign({}, value))), sumOf(list.map(value => Object.assign(full(), value))));

delete list[last].c;
delete typed[last].d;
delete untyped[last].e;
show(list[last], typed[last], untyped[last]);
list[last].c = 1;
typed[last].d = 2;
untyped[last].e = 3;
show(list[last], typed[last], untyped[last]);

const copiedFirst = writtenAgain(order(7).slice(0, 6), 1);
const early: Ten = { ...copiedFirst };
delete copiedFirst.a;
const middle: Ten = { ...copiedFirst };
copiedFirst.a = 5;
delete early.h;
early.h = 6;
show(copiedFirst, early, middle);

const one = writtenAgain(order(31337), 1);
const other = writtenAgain(order(31337), 2);
delete one.b;
delete other.g;
one.b = 0;
show(one, other);
other.g = 0;
delete other.b;
show(one, other, Object.keys(one).join() === Object.keys(other).join());

const emptied = writtenAgain(order(20011), 3);
for (const name of order(4242)) delete emptied[name];
show(emptied, Object.keys(emptied).length);
for (const name of order(9001)) emptied[name] = 1;
show(emptied);

const withOthers = writtenAgain(order(15015), 4) as Ten & Record<string, number>;
withOthers.first = 1;
delete withOthers.d;
withOthers.second = 2;
withOthers.d = 3;
delete withOthers.first;
delete withOthers.f;
withOthers.third = 3;
withOthers.f = 4;
withOthers[7] = 7;
show(withOthers, Object.keys(withOthers), { ...withOthers });
delete withOthers.second;
delete withOthers.third;
delete withOthers.a;
withOthers.a = 9;
show(withOthers, Object.entries(withOthers));

const attempt = (work: () => unknown) => {
  try {
    return work();
  } catch (error) {
    return (error as Error).constructor.name;
  }
};
const frozen = writtenAgain(order(25025), 5);
Object.freeze(frozen);
show(attempt(() => delete frozen.a), attempt(() => (frozen.a = 1)), Object.isFrozen(frozen), frozen);
const sealed = writtenAgain(order(26026), 6);
Object.seal(sealed);
show(attempt(() => delete sealed.a), attempt(() => (sealed.a = 1)), Object.isSealed(sealed), sealed);
const closed = writtenAgain(order(27027), 7);
Object.preventExtensions(closed);
show(attempt(() => delete closed.a), attempt(() => (closed.a = 1)), attempt(() => delete closed.c), Object.isExtensible(closed), closed);

const above = writtenAgain(order(28028), 8);
const below = Object.create(above) as Ten;
delete above.e;
show(below.e, "e" in below, below.f);
above.e = 1;
below.f = 2;
delete above.f;
show(below.e, below.f, above, Object.keys(below));

const moved = writtenAgain(order(29029), 9);
Object.setPrototypeOf(moved, { inherited: 1 });
delete moved.g;
moved.g = 1;
show(moved, "inherited" in moved, Object.getPrototypeOf({ ...moved }) === Object.prototype);

const defined = writtenAgain(order(30030), 10);
Object.defineProperty(defined, "c", { get: () => 42, enumerable: true, configurable: true });
delete defined.h;
defined.h = 1;
show(defined, Object.getOwnPropertyDescriptor(defined, "c")!.get !== undefined);
delete defined.c;
defined.c = 2;
Object.defineProperty(defined, "a", { value: 1, enumerable: false, configurable: true, writable: true });
show(defined, Object.keys(defined), Reflect.ownKeys(defined));

const parsed = order(33033).map((_, at) => JSON.parse("{" + order(33033 + at * 5).map((name, place) => `"${name}":${place}`).join(",") + "}") as Ten);
for (const value of parsed) {
  delete value.b;
  delete value.g;
  value.g = -1;
  value.b = -2;
}
show(parsed);

function written(names: Name[], seed: number): Ten {
  const made: Ten = {};
  for (const name of names) made[name] = seed + name.charCodeAt(0);
  return made;
}
const inOrders: Ten[] = [];
for (let at = 0; at < count; at++) inOrders.push(written(order(at * 3 + 1), at));
console.log(sumOf(inOrders));
const mixed = order(36036);
const between = written(mixed.slice(0, 4), 1) as Ten & Record<string, number>;
between.outside = 1;
for (const name of mixed.slice(4, 8)) between[name] = 2;
between.further = 2;
for (const name of mixed.slice(8)) between[name] = 3;
show(between);
delete between[mixed[1]];
show(between, Object.keys(between));
between[mixed[1]] = 4;
delete between.outside;
delete between[mixed[6]];
between[mixed[6]] = 5;
between.outside = 6;
show(between, Object.keys(between), { ...between });

let setterSaw = 0;
const withSetter = {
  set e(value: number) {
    setterSaw += value;
  },
};
function writtenBelow(above: object, names: Name[], seed: number): Ten {
  const made: Ten = {};
  Object.setPrototypeOf(made, above);
  for (const name of names) made[name] = seed + name.charCodeAt(0);
  return made;
}
for (let at = 0; at < 40; at++) show(writtenBelow(at % 2 ? withSetter : {}, order(35035 + at * 11), at), setterSaw);
