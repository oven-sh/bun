// A host constructor that answers with a string stands where a built in makes its result.
import { CString, ptr } from "bun:ffi";
const bytes = Buffer.from("Hi\0");
const Text = CString.bind(null, ptr(bytes), 0, 2);
function told(name, work) {
  try {
    const made = work();
    console.log(name, typeof made, String(made));
  } catch (error) {
    console.log(name, "throws", error.name);
  }
}
class List extends Array {
  static get [Symbol.species]() {
    return Text;
  }
}
class Bytes extends Uint8Array {
  static get [Symbol.species]() {
    return Text;
  }
}
class Range extends ArrayBuffer {
  static get [Symbol.species]() {
    return Text;
  }
}
class Pattern extends RegExp {
  static get [Symbol.species]() {
    return Text;
  }
}
class Later extends Promise {
  static get [Symbol.species]() {
    return Text;
  }
}
told("new", () => new Text());
told("Reflect.construct", () => Reflect.construct(Text, []));
told("a proxy", () => new (new Proxy(Text, {}))());
told("slice", () => new List(1, 2, 3).slice(0, 2));
told("splice", () => new List(1, 2, 3).splice(0, 2));
told("concat", () => new List(1, 2, 3).concat([4]));
told("map", () => new List(1, 2, 3).map(x => x));
told("filter", () => new List(1, 2, 3).filter(x => x));
told("flat", () => new List(1, [2], 3).flat());
told("flatMap", () => new List(1, 2, 3).flatMap(x => [x]));
told("an empty slice", () => new List().slice());
told("an empty map", () => new List().map(x => x));
told("Array.of", () => Array.of.call(Text, 1, 2));
told("Array.of nothing", () => Array.of.call(Text));
told("Array.from a list", () => Array.from.call(Text, [1, 2]));
told("Array.from what has a length", () => Array.from.call(Text, { length: 2, 0: 1, 1: 2 }));
told("Array.from nothing", () => Array.from.call(Text, []));
told("bytes slice", () => new Bytes(3).slice(0, 2));
told("bytes map", () => new Bytes(3).map(x => x));
told("bytes subarray", () => new Bytes(3).subarray(1));
told("Uint8Array.of", () => Uint8Array.of.call(Text, 1, 2));
told("Uint8Array.from", () => Uint8Array.from.call(Text, [1, 2]));
told("range slice", () => new Range(8).slice(0, 2));
told("split", () => "a,b".split(new Pattern(",")));
told("matchAll", () => [..."a,b".matchAll(new Pattern(",", "g"))]);
told("then", () => Later.resolve(1).then(x => x));
told("Promise.resolve", () => Promise.resolve.call(Text, 1));
told("Promise.all", () => Promise.all.call(Text, []));
told("Promise.withResolvers", () => Promise.withResolvers.call(Text));
for (const [name, items] of [["a list", [1, 2]], ["what has a length", { length: 1, 0: 1 }], ["an asynchronous generator", (async function* () { yield 1; })()]]) {
  try {
    const made = await Array.fromAsync.call(Text, items);
    console.log("Array.fromAsync", name, typeof made, String(made));
  } catch (error) {
    console.log("Array.fromAsync", name, "throws", error.name);
  }
}
// The address is good for as long as the bytes are held.
console.log("the bytes", bytes.join());
