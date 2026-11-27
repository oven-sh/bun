const lengths = [0, 1, 2, 3, 4, 7, 8, 12, 16, 17, 31, 32, 33, 47, 48, 49, 64, 90];
const letters = ["abcxyz_09.", "äöüßéñ_09.", "Δ中λж_09."];
const constants = new Set(["", "a", "ab", "abcxyz_0", "abcxyz_09.abcxyz_09.abcxyz_09.abcxyz_09.abcxyz_0", "abcxyz_09.abcxyz_09.abcxyz_09.abcxyz_09.abcxyz_09"]);
const numbered = new Map([["", 1], ["a", 2], ["abcxyz_0", 1.5], ["abcxyz_09.abcxyz_09.abcxyz_09.abcxyz_09.abcxyz_0", "v"], ["äö", { at: 1 }]]);
const show = (v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
for (const [which, letter] of letters.entries()) {
  const text = letter.repeat(12);
  for (const round of [0, 1]) {
    const counts = new Map();
    const seen = new Set();
    const places = new Map(round ? [["abc", 0], ["ab", 1]] : []);
    let log = "";
    for (let turn = 0; turn < 3; turn++) {
      for (const length of lengths) {
        for (const from of [0, 1, 10]) {
          const key = text.slice(from, from + length);
          log += constants.has(key) ? "c" : "-";
          log += show(numbered.get(key));
          counts.set(key, (counts.get(key) ?? 0) + 1);
          if (!seen.has(key)) seen.add(key);
          else log += "+";
          if (places.has(key)) places.set(key, turn === 1 ? { key } : turn * 1e10 + 0.5);
          else places.set(key, length);
          if (turn === 2 && length % 3 === 0) log += seen.delete(key) ? "d" : "n";
          log += key === [...seen][0] ? "=" : "";
        }
      }
    }
    console.log(which, round, log);
    console.log([...counts].map(([key, count]) => key.length + ":" + count).join(), seen.size, [...seen].map((key) => key.length).join());
    console.log([...places.values()].map(show).join().slice(0, 600));
  }
}
console.log([...constants].join(), [...numbered.keys()].join());
