// A line that is cut from a text with a character beyond Latin-1 is stored wide, and stays so whatever it is compared with: a program that tries its code on wide texts looks at that.
import { jscDescribe } from "bun:jsc";
const cut = (lines: readonly string[]): string[] => ["中", ...lines].join("\n").split("\n").slice(1);
const stored = (text: string) => (jscDescribe(text).includes("8Bit:(0)") ? "wide" : "narrow");
function copyOf(text: string): string {
  let out = "";
  for (const point of text) out += point;
  return out;
}
const plain = ["x ! y and some more", "x # y and some more", "x $ y and some more"];
const [first, second, third] = cut(plain);
console.log("cut from a wide text:", stored(first), stored(second), stored(third));
console.log("behind !== with a narrow copy:", copyOf(first) !== first, stored(first));
console.log("behind === with the narrow text that it was cut from:", plain[1] === second, stored(second));
console.log("behind === with a wide equal:", cut(plain)[2] === third, stored(third));
