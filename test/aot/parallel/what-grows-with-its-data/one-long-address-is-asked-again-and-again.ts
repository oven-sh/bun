// What an address costs goes by its own length, which stays; the query grows with the size once.
// Sizes: 1000 4000 16000
// Passes: 52
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function headOf(address: string): string {
  const link = new URL(address, "http://depot.test");
  const parts = link.pathname.split("/");
  return parts[1] + ":" + parts.length;
}
function once(): string {
  const long = "/crates/7/lids/9?tail=" + "q".repeat(64);
  let seen = 0;
  for (let i = 0; i < size; i++) seen += headOf(long + (i & 7)).length;
  return [seen].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
