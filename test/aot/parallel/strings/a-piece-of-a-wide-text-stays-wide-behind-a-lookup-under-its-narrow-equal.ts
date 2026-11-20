// A line that is cut from a text with a character beyond Latin-1, looked up in a map or a set that holds its equal stored narrow.
import { jscDescribe } from "bun:jsc";
const cut = (lines: readonly string[]): string[] => ["中", ...lines].join("\n").split("\n").slice(1);
const stored = (text: string) => (jscDescribe(text).includes("8Bit:(0)") ? "wide" : "narrow");
const plain = ["x ! y and some more", "x # y and some more", "x $ y and some more", "x % y and some more", "x & y and some more"];
const places = new Map(plain.map((line, place) => [line, place]));
const known = new Set(plain);
const [first, second, third, fourth, fifth] = cut(plain);
console.log("cut from a wide text:", stored(first), stored(second), stored(third), stored(fourth), stored(fifth));
console.log("behind map.get:", places.get(first), first === plain[0]);
console.log("behind map.has:", places.has(second), second === plain[1]);
console.log("behind set.has:", known.has(third), third === plain[2]);
console.log("behind set.add:", known.add(fourth).size, fourth === plain[3]);
console.log("behind map.set:", places.set(fifth, 9).size, fifth === plain[4], places.get(plain[4]));
const joined = "x ! y" + [" and some more"][0];
console.log("a narrow text put together, behind map.get:", places.get(joined), stored(joined));
