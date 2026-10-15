function anyOf(index: number): any {
  switch (index % 11) {
    case 0: return index;
    case 1: return index + 0.5;
    case 2: return "s" + (index % 4);
    case 3: return "s" + (index % 4) + "";
    case 4: return undefined;
    case 5: return null;
    case 6: return BigInt(index % 3);
    case 7: return index % 2 === 0;
    case 8: return ("left" + index).slice(0, 4) + ("right" + (index % 2));
    case 9: return "leftright" + (index % 2);
    default: return NaN;
  }
}

function literals(a: any, b: any, c: any, d: any, e: number, f: string): string {
  const one = { a };
  const two = { a, b };
  const three = { a, b, c };
  const four = { a, b, c, d };
  const five = { a, b, c, d, e };
  const none = {};
  return [typeof one.a, String(two.b), typeof three.c, String(four.d), five.e, Object.keys(none).length, String(a), String(b), String(c), String(d), e, f].join("|");
}

function manyLiterals(rounds: number, a: any, b: any, c: any, d: any): number {
  let total = 0;
  const kept: any[] = [];
  for (let i = 0; i < rounds; i++) {
    const made = { a, b, c, d };
    const other = { i, made };
    if ((i & 255) === 0) kept.push(other);
    total += other.i & 3;
    if (made.a !== a || made.b !== b || made.c !== c || made.d !== d) return -1;
  }
  return total + kept.length;
}

function compares(x: any, y: any, a: number, b: string, c: number[], d: { tag: string }): string {
  const first = x === y;
  const second = y === x;
  const third = x !== y;
  const fourth = x === x;
  return (first ? "T" : "F") + (second ? "T" : "F") + (third ? "T" : "F") + (fourth ? "T" : "F") + a + b + c.length + d.tag;
}

function closuresInFrames(a: number, b: string, c: number[], d: { tag: string }): string {
  const first = () => a + 1;
  const second = () => b + a;
  const third = () => c.length + a + b.length;
  const fourth = () => d.tag + b + c.length + a;
  return [first(), second(), third(), fourth(), a, b, c.length, d.tag].join(",");
}

function readsWithoutASite(from: any, a: number, b: string, c: { tag: string }): string {
  return String(from.alpha) + String(from.beta) + a + b + c.tag + String(from.gamma);
}

const tag = { tag: "T" };
let out = "";
for (let i = 0; i < 22; i++) out += literals(anyOf(i), anyOf(i + 1), anyOf(i + 2), anyOf(i + 3), i, "f" + i) + ";";
console.log(out);
console.log(manyLiterals(60000, "a", 2, tag, [1]), manyLiterals(60000, 1.5, null, undefined, "d"));
let table = "";
for (let i = 0; i < 22; i++) {
  for (let j = 0; j < 22; j++) table += compares(anyOf(i), anyOf(j), i, "b", [j], tag).slice(0, 4) + (j === 21 ? "\n" : " ");
}
console.log(table);
console.log(compares("x".repeat(40) + "y", "x".repeat(40) + "y", 1, "two", [3], tag), compares("é" + "x".repeat(9), "é" + "x".repeat(9), 4, "five", [], tag), compares("x".repeat(9), "é" + "x".repeat(8), 6, "seven", [8, 9], tag));
console.log(closuresInFrames(1, "two", [3, 4], tag));
console.log(readsWithoutASite({ alpha: 1, beta: "b", gamma: null }, 2, "c", tag), readsWithoutASite({ gamma: 3 }, 4, "d", tag));
