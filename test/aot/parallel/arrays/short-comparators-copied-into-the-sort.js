// Flags: --aot-heat=everything-is-hot
// Where all code counts as hot every comparator gets a copy of the sort.
function mix(hash, value) {
  return (Math.imul(hash ^ value, 16777619) + 1) | 0;
}
const shapes = {
  rising: (i, n) => i,
  falling: (i, n) => n - i,
  equal: (i, n) => 7,
  random: (i, n) => (Math.imul(i + 1, 2654435761) >>> 8) % 1000,
  fewValues: (i, n) => (Math.imul(i + 3, 40503) >>> 4) % 4,
  risingThenFalling: (i, n) => (i < n / 2 ? i : n - i),
  longRunsOfTen: (i, n) => (i % 10) + ((i / 10) | 0) * ((i / 10) & 1 ? -3 : 5),
  sawtooth: (i, n) => i % 9,
  nearlyRising: (i, n) => (i % 13 === 12 ? i - 20 : i),
};
const lengths = [];
for (let n = 0; n <= 70; n++) lengths.push(n);
lengths.push(100, 127, 128, 129, 200, 333, 700);
// Short comparators, which the compiler copies into the sort. Nothing watches the calls: the lists must come out the same, equal keys in the order they had.
function sortedByShortComparators(n, shape) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push({ key: shape(i, n), at: i, name: "n" + (shape(i, n) % 17) });
  let hash = 0;
  for (const row of rows.slice().sort((a, b) => a.key - b.key)) hash = mix(hash, row.at);
  for (const row of rows.slice().sort((a, b) => b.key - a.key)) hash = mix(hash, row.at);
  for (const row of rows.slice().sort((a, b) => a.name.localeCompare(b.name))) hash = mix(hash, row.at);
  for (const row of rows.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)))
    hash = mix(hash, row.at);
  for (const row of rows.toSorted((a, b) => a.key - b.key)) hash = mix(hash, row.at);
  for (const key of rows.map(row => row.key + 0.5).sort((a, b) => (a % 5) - (b % 5))) hash = mix(hash, key * 2);
  for (const key of rows.map(row => row.key).sort((a, b) => (a % 5) - (b % 5))) hash = mix(hash, key);
  for (const row of rows.slice().sort((a, b) => a.key > b.key)) hash = mix(hash, row.at);
  return hash;
}
for (const [shapeName, shape] of Object.entries(shapes)) {
  let hash = 0;
  for (let round = 0; round < 3; round++) for (const n of lengths) hash = mix(hash, sortedByShortComparators(n, shape));
  console.log("short comparators", shapeName, hash);
}
