// Class fields on instances of classes that extend host classes: defined, not assigned, whatever the host object is.
const log: string[] = [];
const say = (...parts: unknown[]) => log.push(parts.map(String).join(" "));
const describe = (object: object, key: PropertyKey) => JSON.stringify(Object.getOwnPropertyDescriptor(object, key));

class LazyPromise<T> extends Promise<T> {
  started = false;
  label = "lazy";
  count = 0;
  extra: unknown = null;
  fifth = 5;
}
class CountedMap extends Map<string, number> {
  reads = 0;
  writes = 0;
}
class TaggedSet extends Set<number> {
  tag = "set";
}
class Stamp extends Date {
  note = "stamp";
}
class Rows extends Array<number> {
  command = "SELECT";
  count = 0;
}
class Failure extends Error {
  status = 500;
  message = "replaced";
  stack = "no stack";
}
class Pattern extends RegExp {
  uses = 0;
}
class PatternWithIndex extends RegExp {
  lastIndex = 7;
}
class RowsWithLength extends Array<number> {
  length = 2;
}
class Bytes extends Uint8Array {
  origin = "bytes";
}
class Weak extends WeakMap<object, number> {
  name = "weak";
}
class Text extends String {
  kind = "text";
}
class Buffered extends ArrayBuffer {
  owner = "me";
}

function basics(): void {
  const promise = new LazyPromise<number>(() => {});
  say(Object.keys(promise).join(), describe(promise, "started"), promise.fifth);
  const map = new CountedMap([["a", 1]]);
  say(Object.keys(map).join(), map.size, describe(map, "writes"));
  say(Object.keys(new TaggedSet([1])).join(), Object.keys(new Stamp(0)).join(), new Stamp(0).getTime());
  const rows = new Rows(1, 2, 3);
  say(Object.keys(rows).join(), rows.length, describe(rows, "command"));
  const failure = new Failure("original");
  say(Object.keys(failure).join(), failure.message, failure.stack, describe(failure, "message"));
  const pattern = new Pattern("a", "g");
  say(Object.keys(pattern).join(), pattern.lastIndex, describe(pattern, "lastIndex"));
  for (const make of [() => new PatternWithIndex("a"), () => new RowsWithLength(1, 2, 3)]) {
    try {
      say(Object.keys(make()).join());
    } catch (error) {
      say((error as Error).constructor.name);
    }
  }
  say(Object.keys(new Bytes(2)).join(), Object.keys(new Weak()).join(), Object.keys(new Text("ab")).join(), Object.keys(new Buffered(1)).join());
}

function definedNotAssigned(): void {
  class Base extends Map<string, number> {
    set watched(value: number) {
      say("the setter ran", value);
    }
    get watched(): number {
      return -1;
    }
  }
  class Derived extends Base {
    // @ts-expect-error a field over an accessor
    watched = 3;
  }
  const derived = new Derived();
  say(derived.watched, describe(derived, "watched"));
}

function refusals(): void {
  function returns(object: object) {
    return function () {
      return object;
    } as unknown as new () => object;
  }
  const attempt = (name: string, object: object) => {
    class Stamped extends returns(object) {
      field = 1;
    }
    try {
      new Stamped();
      say(name, describe(object, "field"));
    } catch (error) {
      say(name, (error as Error).constructor.name);
    }
  };
  attempt("a frozen map", Object.freeze(new Map()));
  attempt("a sealed promise", Object.seal(Promise.resolve()));
  attempt("a set that cannot grow", Object.preventExtensions(new Set()));
  attempt("a fixed property", Object.defineProperty(new Map(), "field", { value: 0, configurable: false, writable: false }));
  attempt("a fixed writable property", Object.defineProperty(new Map(), "field", { value: 0, configurable: false, writable: true, enumerable: true }));
  attempt("a hidden property", Object.defineProperty(new Map(), "field", { value: 0, configurable: true, writable: false, enumerable: false }));
  attempt("an accessor", Object.defineProperty(new Date(0), "field", { get: () => 9, configurable: true }));
  const traps: string[] = [];
  attempt("a proxy", new Proxy(new Map(), { defineProperty(target, key, descriptor) { traps.push(String(key) + JSON.stringify(descriptor)); return Reflect.defineProperty(target, key, descriptor); } }));
  say(traps.join());
  attempt("a refusing proxy", new Proxy(new Map(), { defineProperty: () => false }));
}

function manyShapes(): void {
  let total = 0;
  for (let turn = 0; turn < 3000; turn++) {
    const promise = new LazyPromise<number>(() => {});
    const map = new CountedMap();
    if (turn % 1000 === 999) (map as unknown as Record<string, number>).late = turn;
    map.reads += turn;
    promise.count += map.reads;
    total += promise.count + promise.fifth + Object.keys(map).length;
  }
  say(total);
  class Child extends LazyPromise<void> {
    sixth = 6;
    seventh = 7;
    eighth = 8;
    ninth = 9;
  }
  const child = new Child(() => {});
  say(Object.keys(child).join(), child.ninth);
  const asPrototype = new CountedMap();
  const heir: { reads: number } = Object.create(asPrototype);
  say(heir.reads, Object.keys(new CountedMap()).join());
}

basics();
definedNotAssigned();
refusals();
manyShapes();
console.log(log.join("\n"));
