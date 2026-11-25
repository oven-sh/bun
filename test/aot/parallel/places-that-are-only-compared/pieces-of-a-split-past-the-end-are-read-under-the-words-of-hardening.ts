// Under: --aot-harden=proof-checks,ignore-told-ranges: a piece of a split past the end is absent, which is lawful: no net of these words may stop at it, however the piece is read.
const many = process.argv.length > 99;
function parts(line: string): string {
  const [a, b, c] = line.split(",");
  const [p, q] = line.split("::");
  return [a === "x", b === "yy", c === "z", c === "", Number(b), parseInt(c, 10), a + "|" + b + "|" + c, p === "x", q === "y", String(q)].join(" ");
}
for (const line of ["", "x", "x,yy", "x,yy,z", ",,", "x,", "1,2,3,4", "x::y", "::", "x::"]) console.log("SAID", JSON.stringify(line), parts(line + (many ? "x" : "")));
