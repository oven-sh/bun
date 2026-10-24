const lines = [];
const say = (title, value) => lines.push(title + ": " + JSON.stringify(value));
let log = [];
const logged = () => { const seen = log; log = []; return seen; };

const locales = { get length() { log.push("length"); return 0; } };
const options = { get localeMatcher() { log.push("localeMatcher"); return undefined; } };
say("list.toLocaleString(locales, options)", [[1, 2].toLocaleString(locales, options), logged()]);
say("bytes.toLocaleString(locales, options)", [new Int8Array([1, 2]).toLocaleString(locales, options), logged()]);

const converted = { [Symbol.toPrimitive]() { log.push("converted"); return 1; } };
const attempt = action => { try { return action(); } catch (error) { return error.constructor.name; } };
say("push on bytes", [attempt(() => Array.prototype.push.call(new Int8Array(2), converted)), logged()]);
say("unshift on bytes", [attempt(() => Array.prototype.unshift.call(new Int8Array(2), converted)), logged()]);
say("splice on bytes", [attempt(() => Array.prototype.splice.call(new Int8Array(2), 1, 1, converted)), logged()]);

say("reduce on bytes", new Uint8Array([1, 2, 3]).reduce((sum, byte) => (typeof sum === "number" ? "first" : sum + "," + byte)));
say("reduce on bytes from a start", new Uint8Array([1, 2, 3]).reduce((sum, byte) => (typeof sum === "boolean" ? "first" : sum + "," + byte), true));
say("reduceRight on bytes", new Uint8Array([1, 2, 3]).reduceRight((sum, byte) => (typeof sum === "number" ? [sum] : [sum, byte])));
say("reduce on an iterator", [1, 2, 3].values().reduce((sum, item) => (typeof sum === "number" ? "first" : sum + "," + item)));
new Uint8Array([1, 2, 3]).reduce((sum, byte) => { log.push(typeof sum); return String(byte); });
say("reduce whose result is dropped", logged());

const table = new Map();
say("getOrInsertComputed", [table.getOrInsertComputed(-0, key => [typeof key, Object.is(key, 0)]), attempt(() => table.getOrInsertComputed(converted, key => { throw new RangeError(typeof key); })), table.size]);

say("Object.create with descriptors", Object.create(null, { a: { value: { deep: 1 }, enumerable: true } }).a.deep);
say("JSON.stringify with a list of names", [JSON.stringify({ b: { get b() { log.push("inner getter"); return 1; }, c: 2 }, c: 3 }, ["b"]), logged()]);

function* numbers() { yield { yielded: 1 }; }
say("next of a generator", numbers().next().value.yielded);

const wrapped = Iterator.from({ next() { log.push("next"); return { done: false, value: 5 }; }, return() { log.push("return"); return { done: true }; } });
say("a wrapped iterator", [wrapped.next().value, wrapped.return().done, logged()]);

const bound = Function.prototype.bind.call(new Proxy(function target() { return "called"; }, { getPrototypeOf(target) { log.push("getPrototypeOf"); return Reflect.getPrototypeOf(target); } }));
say("bind on a proxy", [bound(), logged()]);

const changing = (list, answer) => ({ valueOf() { list.length = 1; return answer; }, toString() { list.length = 1; return String(answer); } });
const onList = (method, answer, ...rest) => { const list = [1, 2, 3]; return attempt(() => String.prototype[method].call(list, changing(list, answer), ...rest)); };
say("the receiver is converted first", [
  onList("at", 1), onList("charAt", 1), onList("charCodeAt", 1), onList("codePointAt", 1), onList("concat", "a", "a"), onList("indexOf", ",", 1), onList("includes", ",", 1),
  onList("padEnd", 1), onList("padStart", 1), onList("repeat", 1), onList("slice", 1, 3), onList("substr", 1, 1), onList("substring", 1, 3), onList("anchor", "a"), onList("link", "a"),
  onList("startsWith", "1,"), onList("endsWith", ",3"), onList("lastIndexOf", ","), onList("localeCompare", "1"),
]);
const splitList = ["b", "a", "c"];
say("split", String.prototype.split.call(splitList, 1, { valueOf() { splitList.length = 1; return 1; } }));

async function later() {
  const thenable = { then(resolve) { log.push("then"); resolve("settled"); } };
  say("Promise.try", [await Promise.try(value => value, thenable), logged()]);
  say("finally on a thenable", [await Promise.prototype.finally.call({ then(onFulfilled) { log.push("then of the receiver"); return Promise.resolve(1).then(onFulfilled); }, constructor: Promise }, () => { log.push("finally"); }), logged()]);
  console.log(lines.join("\n"));
}
later();
