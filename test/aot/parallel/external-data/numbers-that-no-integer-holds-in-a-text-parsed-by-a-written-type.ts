// Numbers beyond 2^53, with fractions, exponents, a minus in front of zero, too many digits and bad spellings stand where a written type expects a number, and the sums go on from them.
// Under: --aot-testing=CheckProofsAtRunTime: the kind of number that a field holds
type Reading = { id: number; value: number };
function load(text: string) { return JSON.parse(text) as Reading; }
function list(text: string) { return JSON.parse(text) as number[]; }
function show(n: number) { return Object.is(n, -0) ? "-0" : String(n); }
const spellings = ["0", "-0", "1", "-1", "2147483647", "2147483648", "-2147483648", "-2147483649", "4294967296", "9007199254740991", "9007199254740992", "9007199254740993", "-9007199254740993",
  "123456789012345678", "123456789012345678901234567890", "0.1", "1.5", "-1.5", "1e3", "1E3", "1e+3", "1e-3", "1.25e2", "1e308", "1e309", "-1e309", "5e-324", "1e-400", "0.000000000000000000001", "1.0", "100000000000000000000.5"];
for (const spelling of spellings) {
  const reading = load(`{"id":${spelling},"value":${spelling}}`);
  console.log(spelling, show(reading.id), show(reading.value), show(reading.id + reading.value), show(reading.id | 0));
}
console.log(list("[" + spellings.join(",") + "]").map(show).join(" "));
for (const bad of ["01", "+1", ".5", "1.", "1e", "1e+", "-", "--1", "0x10", "1_000", "Infinity", "NaN", "1 2"]) {
  try { console.log(bad, show(load(`{"id":${bad},"value":1}`).id)); } catch (error) { console.log(bad, (error as Error).name); }
}
