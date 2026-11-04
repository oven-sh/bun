// Call apply and bind are themselves taken off.
class Owner {
  first: string = "ann";
}

class Subject {
  count: number = 10;
  label: string = "subject";
  owner: Owner = new Owner();
  action: () => number = () => 7;
  #secret: number = 42;
  readCount(): number {
    return this.count;
  }
  countPlusOne(): number {
    return this.count + 1;
  }
  readLabel(): string {
    return this.label;
  }
  labelLength(): number {
    return this.label.length;
  }
  ownerName(): string {
    return this.owner.first;
  }
  runAction(): number {
    return this.action();
  }
  readSecret(): number {
    return this.#secret;
  }
  storeCount(): number {
    this.count = 99;
    return this.count;
  }
  bump(): number {
    return ++this.count;
  }
  storeLabel(): string {
    this.label = "stored";
    return this.label;
  }
  callsOther(): number {
    return this.readCount() * 2;
  }
  kind(): string {
    return typeof this;
  }
}

function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

const s = new Subject();
const like = { count: 500, label: "like" };

show("call of call", () => Function.prototype.call.call(s.readCount, like));
show("call of call, nothing", () => Function.prototype.call.call(s.readCount, undefined));
show("apply of call", () => Function.prototype.call.apply(s.readCount, [like]));
show("call of apply", () => Function.prototype.apply.call(s.readCount, like, []));
show("call of bind", () => Function.prototype.bind.call(s.readCount, like)());
show("Reflect.apply of call", () => Reflect.apply(Function.prototype.call, s.readCount, [like]));
show("call bound to the method", () => {
  const callReadCount = Function.prototype.call.bind(s.readCount);
  return callReadCount(like) + " " + callReadCount(s);
});
show("the method's own call, taken off", () => {
  const call = s.readCount.call;
  return Reflect.apply(call, s.labelLength, [like]);
});
show("map over receivers", () => [s, like, { count: -1 }].map(receiver => s.readCount.call(receiver)).join());
show("map with call bound", () => {
  const callReadCount = Function.prototype.call.bind(s.readCount);
  return [s, like].map(receiver => callReadCount(receiver)).join();
});
show("bound, then call with another", () => s.readCount.bind(like).call(s));
show("bound, then apply with another", () => s.readCount.bind(like).apply(s));
show("bound, then bound", () => s.readCount.bind(like).bind(s)());
show("bound to nothing", () => s.readCount.bind(undefined)());
show("bound to a number", () => s.kind.bind(5)());
show("bound to null", () => s.kind.bind(null)());
show("a bound private reader on the subject", () => s.readSecret.bind(s)());
show("a bound private reader on a look-alike", () => s.readSecret.bind(like)());
show("name of a bound method", () => s.readCount.bind(like).name);
show("length of a bound method", () => s.readCount.bind(like).length);
