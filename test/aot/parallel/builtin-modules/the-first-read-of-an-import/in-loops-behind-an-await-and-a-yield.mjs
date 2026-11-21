// A named import of node:path is first read in a loop of an async function behind an await, one of node:os in a loop of a generator behind a yield, each behind a call whose loop does not turn.
import { sep } from "node:path";
import { EOL } from "node:os";
async function walk(turns) {
  const seen = [];
  for (let turn = 0; turn < turns; turn++) {
    await null;
    seen.push(sep);
  }
  return seen.length + ":" + seen.join("");
}
function* steps(turns) {
  for (let turn = 0; turn < turns; turn++) {
    yield turn;
    yield JSON.stringify(EOL);
  }
}
console.log(await walk(0), await walk(3), [...steps(0)].length, [...steps(2)].join(" "));
