// Benchmark: tagged template parsing overhead vs array format
// Run with: bun ./bench/test-each/each-tagged-template.mjs
const N = 5000;

// Simulate the array format (baseline)
const arrayData = [[1, 2, 3], [4, 5, 9], [7, 8, 15]];

// Simulate tagged template parsing (what our code does)
function parseTaggedTemplate(strings, ...values) {
  const header = strings[0].split('\n').find(l => l.trim()).split('|').map(s => s.trim()).filter(Boolean);
  const cols = header.length;
  const rows = [];
  for (let i = 0; i < values.length; i += cols) {
    const obj = {};
    for (let j = 0; j < cols; j++) obj[header[j]] = values[i + j];
    rows.push(obj);
  }
  return rows;
}

const strings = ['\n  a    | b    | expected\n  ', ' | ', ' | ', '\n  ', ' | ', ' | ', '\n  ', ' | ', ' | ', '\n'];
strings.raw = strings;

// Warm up
for (let i = 0; i < 100; i++) parseTaggedTemplate(strings, 1, 2, 3, 4, 5, 9, 7, 8, 15);

const t1 = Bun.nanoseconds();
for (let i = 0; i < N; i++) {
  // Array format: just iterate
  for (const row of arrayData) { const [a, b, c] = row; }
}
const arrayTime = Bun.nanoseconds() - t1;

const t2 = Bun.nanoseconds();
for (let i = 0; i < N; i++) {
  parseTaggedTemplate(strings, 1, 2, 3, 4, 5, 9, 7, 8, 15);
}
const templateTime = Bun.nanoseconds() - t2;

console.log(`Array format:    ${(arrayTime / N).toFixed(0)} ns/iter`);
console.log(`Tagged template: ${(templateTime / N).toFixed(0)} ns/iter`);
console.log(`Ratio: ${(templateTime / arrayTime).toFixed(2)}x`);
