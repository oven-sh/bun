// Methods found through instances: each class here is the handler of a proxy with a `get` trap whose key parameter says string, as the program's call does, and one native operation that asks for a well-known symbol. A bit is set for each such operation.

let bits = 0;

function attempt(run: () => unknown): void {
  try {
    run();
  } catch {}
}

class ByString { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 1; return undefined; } }
class BySpread { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 2; return undefined; } }
class ByTag { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 4; return undefined; } }
class ByConcat { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 8; return undefined; } }
class ByInstanceOf { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 16; return undefined; } }
class ByStartsWith { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 32; return undefined; } }
class ByReplace { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 64; return undefined; } }
class BySplit { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 128; return undefined; } }
class BySearch { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 256; return undefined; } }
class ByMatch { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 512; return undefined; } }
class ByMatchAll { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 1024; return undefined; } }
class ByForAwait { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 2048; return undefined; } }
class ByArrayFrom { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 4096; return undefined; } }
class ByNumber { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 8192; return undefined; } }
class ByDate { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 16384; return undefined; } }
class BySpecies { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 32768; return undefined; } }
class ByAssign { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 65536; return undefined; } }
class ByObjectSpread { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 131072; return undefined; } }
class ByReflectGet { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 262144; return undefined; } }
class ByHeir { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 524288; return undefined; } }
class ByFromAsync { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 1048576; return undefined; } }
class BySet { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 2097152; return undefined; } }
class ByKey { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 4194304; return undefined; } }
class ByPromiseAll { get(target: object, key: string): unknown { if (typeof key !== "string") bits |= 8388608; return undefined; } }

new ByString().get({}, "k");
attempt(() => String(new Proxy({}, (new ByString() as any))));
new BySpread().get({}, "k");
attempt(() => [...(new Proxy({}, (new BySpread() as any)) as any)]);
new ByTag().get({}, "k");
attempt(() => Object.prototype.toString.call(new Proxy({}, (new ByTag() as any))));
new ByConcat().get({}, "k");
attempt(() => ([] as any[]).concat(new Proxy({}, (new ByConcat() as any))));
new ByInstanceOf().get({}, "k");
attempt(() => ({}) instanceof (new Proxy({}, (new ByInstanceOf() as any)) as any));
new ByStartsWith().get({}, "k");
attempt(() => "a".startsWith(new Proxy({}, (new ByStartsWith() as any)) as any));
new ByReplace().get({}, "k");
attempt(() => "a".replace(new Proxy({}, (new ByReplace() as any)) as any, "b"));
new BySplit().get({}, "k");
attempt(() => "a".split(new Proxy({}, (new BySplit() as any)) as any));
new BySearch().get({}, "k");
attempt(() => "a".search(new Proxy({}, (new BySearch() as any)) as any));
new ByMatch().get({}, "k");
attempt(() => "a".match(new Proxy({}, (new ByMatch() as any)) as any));
new ByMatchAll().get({}, "k");
attempt(() => "a".matchAll(new Proxy({}, (new ByMatchAll() as any)) as any));
new ByForAwait().get({}, "k");
attempt(() => (async () => { for await (const one of new Proxy({}, (new ByForAwait() as any)) as any) return one; })().catch(() => 0));
new ByArrayFrom().get({}, "k");
attempt(() => Array.from(new Proxy({}, (new ByArrayFrom() as any)) as any));
new ByNumber().get({}, "k");
attempt(() => Number(new Proxy({}, (new ByNumber() as any))));
new ByDate().get({}, "k");
attempt(() => new Date(new Proxy({}, (new ByDate() as any)) as any));
new BySpecies().get({}, "k");
attempt(() => Array.prototype.map.call(Object.assign([1], { constructor: new Proxy({}, (new BySpecies() as any)) }), one => one));
new ByAssign().get({}, "k");
attempt(() => Object.assign({}, new Proxy({ [Symbol.iterator]: 1 }, (new ByAssign() as any))));
new ByObjectSpread().get({}, "k");
attempt(() => ({ ...new Proxy({ [Symbol.iterator]: 1 }, (new ByObjectSpread() as any)) }));
new ByReflectGet().get({}, "k");
attempt(() => Reflect.get(new Proxy({}, (new ByReflectGet() as any)), Symbol.iterator));
new ByHeir().get({}, "k");
attempt(() => String(Object.create(new Proxy({}, (new ByHeir() as any)))));
new ByFromAsync().get({}, "k");
attempt(() => Array.fromAsync(new Proxy({}, (new ByFromAsync() as any)) as any).catch(() => 0));
new BySet().get({}, "k");
attempt(() => new Set(new Proxy({}, (new BySet() as any)) as any));
new ByKey().get({}, "k");
attempt(() => ({} as any)[new Proxy({}, (new ByKey() as any)) as any]);
new ByPromiseAll().get({}, "k");
attempt(() => Promise.all(new Proxy({}, (new ByPromiseAll() as any)) as any).catch(() => 0));
setTimeout(() => console.log(bits.toString(2)), 5);
