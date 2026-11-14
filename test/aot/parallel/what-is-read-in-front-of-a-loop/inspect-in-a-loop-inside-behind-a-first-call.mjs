// The first call in the outer turn loads the file of util.inspect. The loop inside stands behind it, and the outer loop does not.
import util from "node:util";
let last = "";
for (let turn = 0; turn < Number("2"); turn++) {
  last = util.inspect({});
  for (let inner = 0; inner < Number("2"); inner++) last += util.inspect([]);
}
console.log(last);
