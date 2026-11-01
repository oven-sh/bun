// Flags: --aot-heat=ReadOffStructure
// The name that a walk hands out is kept in a member, in a function that a very large program ranks cold. One of 22 forms; walked-key.js says what went wrong.
const cliDefaults = { verbose: false, color: true, retries: 3 };
function makeSummary() { return { lastOption: "none", count: 0, calls: 0, total: 0, largest: 0, smallest: 0, odd: 0, even: 0 }; }
function summarize(summary, options, weight) {
  summary.calls += 1;
  summary.total += weight;
  if (summary.total > 100) summary.total -= 100;
  if (weight > summary.largest) summary.largest = weight;
  if (weight < summary.smallest || summary.calls === 1) summary.smallest = weight;
  if (weight % 2 === 1) summary.odd += 1; else summary.even += 1;
  if (summary.odd > summary.even + 10) summary.odd = summary.even;
  if (summary.largest - summary.smallest > 50) summary.largest = summary.smallest + 50;
  for (const name of Object.keys(options)) { summary.lastOption = name; summary.count += 1; }
  return summary.count;
}
function sameLastOption(a, b) { return a.lastOption === b.lastOption; }
const first = makeSummary(), second = makeSummary();
summarize(first, cliDefaults, 1);
console.log(String(sameLastOption(first, second)));
summarize(first, cliDefaults, 2);
console.log(String(sameLastOption(first, second)));
console.log(first.lastOption + " " + String(first.count));
