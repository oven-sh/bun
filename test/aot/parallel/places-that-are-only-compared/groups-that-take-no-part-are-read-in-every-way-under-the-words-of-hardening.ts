// Under: --aot-harden=proof-checks,ignore-told-ranges: the bounds of a group that takes no part are -1, -1, which is lawful: no net of these words may stop at them, however the group is read.
const many = process.argv.length > 99;
function read(subject: string, table: Map<string, number>): string {
  const m = /^(\d+)?(?:-(\d+))?(x)?$/.exec(subject);
  if (!m) return "no";
  let out = "";
  out += m[1] === "12"; out += " "; out += m[2] === "7"; out += " "; out += m[2] === ""; out += " "; out += m[3] !== "x";
  out += " " + Number(m[2]) + " " + parseInt(m[1], 10) + " " + parseInt(m[2]) + " " + table.get(m[2]) + " " + table.has(m[3]);
  out += " "; out += m[3]; out += m[2];
  return out;
}
const table = new Map([["7", 70], ["x", 1]]);
for (const subject of ["", "12", "12-7", "-7", "x", "12x", "-7x", "y"]) console.log("SAID", JSON.stringify(subject), read(subject + (many ? "y" : ""), table));
