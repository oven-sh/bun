// The bound arrives at run time, so the loop is built as a loop. The file of util.inspect loads in its first turn.
import util from "node:util";
let last = "";
for (let turn = 0; turn < Number("3"); turn++) last = util.inspect({ turn });
console.log(last);
