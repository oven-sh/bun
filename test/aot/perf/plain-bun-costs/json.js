const rows = [];
for (let i = 0; i < 400; i++)
  rows.push({ id: i, name: "user " + i, quote: 'say "hi"\n\t' + i, ratio: i / 3, whole: i * 1.0, tags: ["a", "b", "ünï" + i], nested: { on: i % 2 === 0, none: null, list: [i, i + 0.5, -i], deep: { x: { y: { z: i } } } }, missing: undefined });
let sum = 0;
for (let round = 0; round < 60; round++) {
  const text = JSON.stringify(rows);
  sum += text.length + JSON.parse(text).length;
  sum += JSON.stringify(rows[round], null, 2).length + JSON.stringify(rows[round], ["id", "name", "tags"]).length;
  sum += JSON.parse(text, (key, value) => (key === "ratio" ? 0 : value))[round].ratio;
  sum += JSON.stringify({ toJSON() { return { round }; } }).length;
}
console.log(sum);
