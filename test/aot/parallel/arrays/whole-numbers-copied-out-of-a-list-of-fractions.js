function make() {
  const list = [1.5, 2, 3, 4, -0, 2147483647, -2147483648, 4294967296];
  list[0] = 1;
  return list;
}
const lines = [];
const say = (label, value) => lines.push(label + " " + (Object.is(value, -0) ? "-0" : typeof value === "object" ? JSON.stringify(value) : String(value)));
function check(copy, label) {
  say(label + " indexOf", [copy.indexOf(1), copy.indexOf(3), copy.indexOf(0), copy.indexOf(2147483647), copy.indexOf(5)].join());
  say(label + " lastIndexOf", [copy.lastIndexOf(2), copy.lastIndexOf(-2147483648)].join());
  say(label + " includes", [copy.includes(1), copy.includes(4), copy.includes(-0), copy.includes(5)].join());
  say(label + " strict", [copy[0] === 1, copy[1] === 2, 3 === copy[2], copy[4] === 0, copy[0] !== 1].join());
  say(label + " loose", [copy[0] == 1, copy[1] == "2", copy[0] == true].join());
  say(label + " is", [Object.is(copy[0], 1), Object.is(copy[4], -0), Object.is(copy[4], 0)].join());
  say(label + " set", [new Set(copy).has(1), new Set(copy).has(3), new Set(copy).has(0), new Set(copy).size].join());
  const map = new Map(copy.map((item, at) => [item, at]));
  say(label + " map", [map.get(1), map.get(2), map.get(0), map.get(4294967296)].join());
  const other = ["a", "b", "c", "d", "e"];
  say(label + " as an index", [other[copy[0]], other[copy[1]], other[copy[3]], other.at(copy[0]), "abcde"[copy[2]], "abcde".charAt(copy[1])].join());
  const keyed = { 1: "one", 2: "two" };
  say(label + " as a key", [keyed[copy[0]], keyed[copy[1]], copy[0] in keyed, Object.hasOwn(keyed, copy[1])].join());
  let chosen = "";
  for (const item of copy) {
    switch (item) {
      case 1: chosen += "one "; break;
      case 3: chosen += "three "; break;
      case 0: chosen += "zero "; break;
      case 2147483647: chosen += "most "; break;
      default: chosen += "- ";
    }
  }
  say(label + " switch", chosen);
  say(label + " arithmetic", [copy[0] + copy[1], copy[2] * copy[3], copy[3] % copy[2], copy[1] ** copy[2], copy[5] + 1, copy[6] - 1, -copy[0], 1 / copy[4]].join());
  say(label + " bits", [copy[0] | 0, copy[1] << copy[2], copy[5] >>> 0, ~copy[3], copy[7] | 0, copy[6] >> 1, copy[2] & copy[0], copy[2] ^ copy[1]].join());
  say(label + " text", [String(copy[0]), copy[1] + "", `${copy[2]}`, copy[3].toString(2), copy[0].toFixed(1), JSON.stringify(copy)].join(" "));
  say(label + " tests", [Number.isInteger(copy[0]), Number.isSafeInteger(copy[7]), typeof copy[0], copy[0] < copy[1], copy[1] >= 2, Math.max(...copy), Math.min(...copy)].join());
  say(label + " sorted", [...copy].sort((a, b) => a - b));
  say(label + " sorted as text", [...copy].sort());
  say(label + " typed arrays", [Array.from(new Int32Array(copy)).join("/"), Array.from(new Uint8Array(copy)).join("/"), Array.from(new Float64Array(copy)).join("/")].join(" "));
  say(label + " lengths", [new Array(copy[2]).length, "x".repeat(copy[3]), [9, 8, 7, 6].slice(copy[0], copy[2]).join("/"), "abcdef".slice(copy[0], copy[3]), "abcdef".substring(copy[1])].join());
  say(label + " filter", copy.filter(item => item === 1 || item === 4));
  say(label + " find", [copy.find(item => item === 3), copy.findIndex(item => item === 4), copy.findLast(item => item === 2)].join());
  say(label + " join", copy.join("|"));
  say(label + " reduce", copy.reduce((sum, item) => sum + item, 0));
  const target = [0, 0, 0, 0];
  target[copy[0]] = copy[1];
  target[copy[2]] = copy[3];
  say(label + " stores", target);
  say(label + " equal lists", copy.every((item, at) => item === make()[at] || (item === 0 && at === 4)));
}
for (let round = 0; round < 3; round++) {
  const list = make();
  check([...list], "spread");
  check([...list, 5].slice(0, 8), "spread and one");
  check([0, ...list].slice(1), "one and spread");
  check(Array.from(list), "from");
  check(list.slice(), "slice");
  check(list.concat(), "concat");
  check(["text", ...list].slice(1), "beside a text");
}
console.log([...new Set(lines)].join("\n"));
