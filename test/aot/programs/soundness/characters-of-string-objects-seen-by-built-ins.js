// The characters of a String object are own enumerable properties: whatever lists, copies or reads the own properties of an object finds them.
function line(name, body) {
  try {
    console.log(name, JSON.stringify(body()));
  } catch (error) {
    console.log(name, "threw", error.constructor.name);
  }
}

const copy = Object.assign([], new String("ab"));
console.log(typeof copy[0], copy[0] === undefined, copy[0].length, copy.length);

line("in", () => { const text = new String("abc"); return [1 in text, 3 in text, "1" in text, "length" in text, "01" in text]; });
line("hasOwn", () => { const text = new String("abc"); return [Object.hasOwn(text, "1"), Object.hasOwn(text, 3), text.hasOwnProperty(2), text.hasOwnProperty("length")]; });
line("keys", () => { const keys = Object.keys(new String("abc")); return [keys, keys.length, typeof keys[0], keys[0].length]; });
line("values", () => { const values = Object.values(new String("abc")); return [values, typeof values[0], values[0] === undefined, values[0].length]; });
line("entries", () => { const entries = Object.entries(new String("ab")); return [entries, typeof entries[0][1], entries[1][1].length]; });
line("names", () => Object.getOwnPropertyNames(new String("ab")));
line("own keys", () => Reflect.ownKeys(new String("ab")));
line("for in", () => { const seen = []; for (const key in new String("abc")) seen.push(key); return seen; });
line("for in over an heir", () => { const seen = []; for (const key in Object.create(new String("ab"))) seen.push(key); return seen; });
line("descriptor", () => { const found = Object.getOwnPropertyDescriptor(new String("abc"), "1"); return [typeof found, typeof found.value, found.value.length, found]; });
line("descriptor past the end", () => typeof Object.getOwnPropertyDescriptor(new String("abc"), "3"));
line("descriptors", () => { const all = Object.getOwnPropertyDescriptors(new String("ab")); return [typeof all[0], typeof all[0].value, all[1].value.length, all.length]; });
line("spread into an object", () => { const object = { ...new String("ab") }; return [typeof object[0], object[0] === undefined, object[1].length, object]; });
line("rest of a pattern", () => { const { 0: first, ...rest } = new String("abc"); return [first.length, typeof rest[1], rest[2].length, rest]; });
line("spread into an array", () => { const list = [...new String("ab")]; return [typeof list[0], list[0] === undefined, list[1].length, list]; });
line("spread into arguments", () => { const kinds = (...values) => values.map(value => typeof value); return kinds(...new String("ab")); });
line("assign to an array", () => { const list = Object.assign([], new String("ab")); return [typeof list[0], list[0] === undefined, list[1].length, list.length, list]; });
line("assign to an object", () => { const object = Object.assign({}, new String("ab")); return [typeof object[1], object[1] === undefined, object[0].length, object]; });
line("assign to a String object", () => { const text = Object.assign(new String("ab"), { 5: 1, tag: "t" }); return [typeof text[0], typeof text[5], text.tag, Object.keys(text)]; });
line("stringify", () => [JSON.stringify(new String("ab")), JSON.stringify({ member: new String("x") }), JSON.stringify([new String("y")]), JSON.stringify(Object.create(new String("z")))]);
line("map", () => Array.prototype.map.call(new String("ab"), (character, index) => typeof character + ":" + character.length + ":" + index));
line("for each", () => { const seen = []; Array.prototype.forEach.call(new String("ab"), character => { seen.push(character === undefined ? "none" : character.length); }); return seen; });
line("filter", () => { const kept = Array.prototype.filter.call(new String("abc"), character => character !== "b"); return [typeof kept[0], kept[1].length, kept]; });
line("reduce", () => Array.prototype.reduce.call(new String("abc"), (sum, character) => sum + character.length, 0));
line("find", () => { const found = Array.prototype.find.call(new String("abc"), character => character > "a"); return [typeof found, found.length]; });
line("join", () => Array.prototype.join.call(new String("abc"), "-"));
line("slice", () => { const part = Array.prototype.slice.call(new String("abc"), 1); return [typeof part[0], part[0] === undefined, part[1].length, part]; });
line("concat", () => { const both = Array.prototype.concat.call([], new String("ab")); return [both.length, typeof both[0], typeof both[0][1]]; });
line("index of", () => [Array.prototype.indexOf.call(new String("abc"), "b"), Array.prototype.includes.call(new String("abc"), "c"), Array.prototype.at.call(new String("abc"), -1)]);
line("from", () => { const list = Array.from(new String("ab")); return [typeof list[0], list[0] === undefined, list[1].length, list]; });
line("from with a function", () => Array.from(new String("ab"), character => character.length));
line("apply", () => { const kinds = (...values) => values.map(value => typeof value); return [kinds.apply(null, new String("ab")), Reflect.apply(kinds, null, new String("c"))]; });
line("object pattern", () => { const { 0: first, 1: next, 2: none, length } = new String("ab"); return [typeof first, first.length, next, none === undefined, length]; });
line("array pattern", () => { const [first, next, none] = new String("ab"); return [typeof first, first.length, next, none === undefined]; });
line("for of", () => { const seen = []; for (const character of new String("ab")) seen.push(character.length); return seen; });
line("get", () => { const found = Reflect.get(new String("ab"), 1); return [typeof found, found === undefined, found.length, typeof Reflect.get(new String("ab"), 2)]; });
line("has", () => [Reflect.has(new String("ab"), 1), Reflect.has(new String("ab"), 2)]);
line("integrity", () => [Object.isFrozen(new String("ab")), Object.isSealed(new String("ab")), Object.isFrozen(Object.preventExtensions(new String("ab"))), Object.isFrozen(Object.preventExtensions(new String(""))), Object.isExtensible(new String("ab"))]);
line("enumerable", () => [new String("ab").propertyIsEnumerable(0), new String("ab").propertyIsEnumerable("length"), new String("ab").propertyIsEnumerable(5)]);
line("a set and a map", () => [[...new Set(new String("aab"))], new Map([new String("kv")]).get("k")]);
line("from entries", () => Object.fromEntries([new String("kv"), new String("xy")]));
class Tagged extends String {
  tag = 1;
}
line("keys of an instance of a class below String", () => [Object.keys(new Tagged("ab")), Object.getOwnPropertyNames(new Tagged("ab")), Object.entries(new Tagged("a"))]);
line("for in over an instance of a class below String", () => { const seen = []; for (const key in new Tagged("ab")) seen.push(key); return seen; });
line("copies of an instance of a class below String", () => { const object = { ...new Tagged("ab") }; const list = Object.assign([], new Tagged("cd")); return [object, typeof object[0], object[1].length, list[0].length, list.tag]; });
line("values of an instance of a class below String", () => { const values = Object.values(new Tagged("ab")); return [values, typeof values[0], typeof values[2]]; });
line("stringify of an instance of a class below String", () => [JSON.stringify(new Tagged("ab")), JSON.stringify({ member: new Tagged("c") })]);
line("structured clone", () => { const clone = structuredClone(new String("ab")); return [typeof clone, typeof clone[0], clone[1].length]; });
