// A line that is cut from a text with a character beyond Latin-1 is stored wide, and stays so where it is looked up in a map or a set that holds its equal stored narrow.
import { jscDescribe } from "bun:jsc";
const cut = (lines: readonly string[]): string[] => ["中", ...lines].join("\n").split("\n").slice(1);
const stored = (text: string) => (jscDescribe(text).includes("8Bit:(0)") ? "wide" : "narrow");
const plain = ["x ! y and some more", "x # y and some more", "x $ y and some more", "x % y and some more", "x & y and some more"];
const places = new Map(plain.map((line, place) => [line, place]));
const known = new Set(plain);
const [first, second, third, fourth, fifth] = cut(plain);
console.log("cut from a wide text:", stored(first), stored(second), stored(third), stored(fourth), stored(fifth));
console.log("behind map.get:", places.get(first), stored(first));
console.log("behind map.has:", places.has(second), stored(second));
console.log("behind set.has:", known.has(third), stored(third));
console.log("behind set.add:", known.add(fourth).size, stored(fourth));
console.log("behind map.set:", places.set(fifth, 9).size, stored(fifth));
const joined = "x ! y" + [" and some more"][0];
console.log("a narrow text put together, behind map.get:", places.get(joined), stored(joined));
