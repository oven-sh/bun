// String.prototype[Symbol.iterator] converts its receiver first, so a String object, an instance of a class below String and any object with a toString are gone over character by character.
// Each character is used as the string it is. Nothing else in the program opens Bun's library.
const kinds = (...values) => values.map(value => typeof value);
console.log(kinds(...new String("ab")), [...new String("ab")][1].length, new Set(new String("aab")).size, Array.from(new String("xy"))[0].length, Object.values(new String("pq"))[1].length);
class Tagged extends String {}
console.log([...new Tagged("cd")][0].toUpperCase(), Math.max(...new String("123")), new Map([new String("kv")]).get("k").length);
const [first, ...rest] = new String("abc");
console.log(first.length, rest.length, rest[1].toUpperCase());
for (const character of new String("z")) console.log(character.length);
console.log([...Object("q")][0].length, String.prototype[Symbol.iterator].call({ toString: () => "obj" }).next().value.length);
