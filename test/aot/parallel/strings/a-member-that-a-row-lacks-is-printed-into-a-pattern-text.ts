// The rows of a table are mapped to patterns by a template that prints several members of a row. A member may be a text or a number, may be null, and some rows lack it: then the template prints
// "undefined". These are texts like any other, and the build knows them: it used to give up at the first part that was neither a text nor a number.
// COUNTER: RegExpsCreatedWithoutRecord = 0
// COUNTER: RegExpsCompiledToBytecode = 0
// COUNTER: RegExpMatchesInterpreted = 0
type Row = { name: string; source: string; flags?: string; open: string | number; close?: string; sep: string | null; strict: boolean };
const OUTER = "[ \\t]*";
const TABLE: Row[] = [
  { name: "one", source: "ab+", flags: "gi", open: "<", close: ">", sep: ",", strict: true },
  { name: "two", source: "c[de]", open: 7, close: "\\]", sep: ";", strict: false },
  { name: "three", source: "xy", open: "\\(", sep: ":", strict: true },
  { name: "four", source: "\\d{2,4}", flags: "g", open: "\\{", close: "\\}", sep: null, strict: false },
];
function compile(isGlobal: boolean): RegExp[] {
  return TABLE.map(row => {
    const flags = (row.flags ?? "").replace("g", "");
    return new RegExp(`^${row.open}x${row.close}y${OUTER}z${row.sep}w${row.strict}${row.source}`, isGlobal ? flags + "g" : flags);
  });
}
const made = compile(process.argv.length < 99);
console.log(made.map(each => each.source + "/" + each.flags).join(" "));
console.log(made.map(each => (each.test("<x>y z,wtrueab") || each.test("(xundefinedy z:wtruexy") ? 1 : 0)).join(""));
