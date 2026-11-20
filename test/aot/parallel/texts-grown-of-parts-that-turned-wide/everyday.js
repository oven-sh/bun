// nearer to everyday code: rows out of a JSON document that holds one non-Latin-1 character somewhere; a report is built by += on a field while a tally is kept by name
const rows = JSON.parse(JSON.stringify({ title: "Ünïcode ✓", items: Array.from({ length: 30000 }, (_, i) => ({ name: "customer-account-" + (100000 + (i % 5000)), amount: i })) }));
const tally = {};
for (const row of rows.items) tally[row.name] = 0;
const report = { text: "report\n" };
let expected = "report\n";
for (let i = 0; i < 30000; i++) {
  const name = "customer-account-" + (100000 + (i % 5000));
  report.text += name;
  tally[name] += 1;
  expected = expected.concat(name);
}
console.log(report.text.length, report.text.indexOf("\0"), report.text === expected, Object.keys(tally).length);
