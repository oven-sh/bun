// A URL for each request, its path cut at the slashes.
// Sizes: 1000 4000 16000
// Passes: 48
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function routeOf(address: string): string {
  const link = new URL(address, "http://depot.test");
  const parts = link.pathname.split("/");
  return parts.length === 5 && parts[1] === "crates" ? parts[2] + "+" + parts[4] : parts[1] + link.search;
}
function once(): string {
  let seen = 0;
  for (let i = 0; i < size; i++)
    seen += routeOf("/crates/" + i + "/lids/" + (i & 15) + "?tail=" + "q".repeat(i & 31)).length;
  return [seen].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
