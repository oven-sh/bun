// The loop has no turn, so nobody loads the file of util.inspect, and nothing of that file is read.
import util from "node:util";
let last = "none";
for (let turn = 0; turn < Number("0"); turn++) last = util.inspect({});
console.log(last);
