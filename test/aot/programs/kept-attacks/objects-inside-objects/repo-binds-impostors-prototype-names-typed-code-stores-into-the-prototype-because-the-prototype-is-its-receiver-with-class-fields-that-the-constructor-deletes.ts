// TypeScript gives `C.prototype` the type C, so typed code can be handed the prototype object itself, without a cast: the store that fills a field of an instance
// then makes a property on the prototype, and every instance inherits it. Eight ways: an argument, a method call, .call, .bind, a lazy getter read on the prototype,
// the same getter through Reflect.get with the prototype as the receiver, the `this` argument of forEach, and a store between two reads of an instance in one function.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
class ByArgument {
  memo?: number;
  constructor(public id: number) {
    delete this.memo;
    handOver(this);
  }
}
function fill(object: ByArgument, value: number) {
  object.memo = value;
}
function memoOf(object: ByArgument) {
  return object.memo;
}
class Between {
  memo?: number;
  constructor(public id: number) {
    delete this.memo;
    handOver(this);
  }
}
function readStoreRead(first: Between, second: Between) {
  const before = first.memo;
  second.memo = 80;
  return `${before} ${first.memo}`;
}
class ByMethod {
  memo?: number;
  constructor(public id: number) {
    delete this.memo;
    handOver(this);
  }
  fill(value: number) { this.memo = value; }
  read() { return this.memo; }
}
class ByCall {
  memo?: number;
  constructor(public id: number) {
    delete this.memo;
    handOver(this);
  }
  fill(value: number) { this.memo = value; }
  read() { return this.memo; }
}
class ByBind {
  memo?: number;
  constructor(public id: number) {
    delete this.memo;
    handOver(this);
  }
  fill(value: number) { this.memo = value; }
  read() { return this.memo; }
}
let computed = 0;
class ByGetter {
  memo?: number;
  constructor(public id: number) {
    delete this.memo;
    handOver(this);
  }
  get lazy() { return (this.memo ??= ++computed + 100); }
  read() { return this.memo; }
}
class ByReceiver {
  memo?: number;
  constructor(public id: number) {
    delete this.memo;
    handOver(this);
  }
  get lazy() { return (this.memo ??= ++computed + 200); }
  read() { return this.memo; }
}
class ByThisArgument {
  memo?: number;
  constructor(public id: number) {
    delete this.memo;
    handOver(this);
  }
  read() { return this.memo; }
}
function keep(this: ByThisArgument, value: number) {
  this.memo = value;
}
function own(object: object) {
  return `[${Object.keys(object)}]`;
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const a = new ByArgument(i), b = new ByMethod(i), c = new ByCall(i), d = new ByBind(i), e = new ByGetter(i), f = new ByReceiver(i), g = new ByThisArgument(i);
  sum += (memoOf(a) ?? 1) + (b.read() ?? 1) + (c.read() ?? 1) + (d.read() ?? 1) + (e.read() ?? 1) + (f.read() ?? 1) + (g.read() ?? 1);
  if (i & 1) {
    fill(a, 2);
    b.fill(2);
    c.fill.call(c, 2);
    d.fill.bind(d)(2);
    [2].forEach(keep, g);
  }
  if (i === 2999) sum += e.lazy + f.lazy;
  sum += (memoOf(a) ?? 1) + (b.read() ?? 1) + (c.read() ?? 1) + (d.read() ?? 1) + (g.read() ?? 1);
}
console.log("warm", sum);

const a = new ByArgument(1), b = new ByMethod(1), c = new ByCall(1), d = new ByBind(1), e = new ByGetter(1), f = new ByReceiver(1), g = new ByThisArgument(1);
fill(ByArgument.prototype, 10);
console.log("an argument:", memoOf(a), own(a), memoOf(new ByArgument(2)), Object.hasOwn(ByArgument.prototype, "memo"));
ByMethod.prototype.fill(20);
console.log("a method call:", b.read(), own(b), new ByMethod(2).read(), Object.hasOwn(ByMethod.prototype, "memo"));
c.fill.call(ByCall.prototype, 30);
console.log(".call:", c.read(), own(c), new ByCall(2).read(), Object.hasOwn(ByCall.prototype, "memo"));
d.fill.bind(ByBind.prototype)(40);
console.log(".bind:", d.read(), own(d), new ByBind(2).read(), Object.hasOwn(ByBind.prototype, "memo"));
const first = ByGetter.prototype.lazy;
console.log("a lazy getter:", first, e.read(), e.lazy, own(e), new ByGetter(2).lazy, Object.hasOwn(ByGetter.prototype, "memo"));
const second = Reflect.get(f, "lazy", ByReceiver.prototype);
console.log("a receiver:", second, f.read(), f.lazy, own(f), new ByReceiver(2).lazy, Object.hasOwn(ByReceiver.prototype, "memo"));
[70].forEach(keep, ByThisArgument.prototype);
console.log("a this argument:", g.read(), own(g), new ByThisArgument(2).read(), Object.hasOwn(ByThisArgument.prototype, "memo"));
for (let i = 0; i < 3000; i++) sum += readStoreRead(new Between(i), new Between(i)).length;
const between = new Between(1);
console.log("between two reads:", sum, readStoreRead(between, Between.prototype), own(between), readStoreRead(new Between(2), new Between(3)));
fill(a, 11);
b.fill(21);
console.log("own ones over them:", memoOf(a), own(a), b.read(), own(b));
delete ByArgument.prototype.memo;
delete ByGetter.prototype.memo;
console.log("deleted:", memoOf(new ByArgument(3)), new ByGetter(3).read(), new ByGetter(4).lazy, computed);
