import events from "node:events";
import fs from "node:fs";
import util from "node:util";
const unseen = (0, eval);
function use(i) { return [typeof new events.EventEmitter().on, fs.existsSync("/definitely/not/there" + i), util.format("%s", i)].join(); }
const said = [];
for (let i = 0; i < 6; i++) {
  if (i === 2) unseen("(e, f, u) => { e.EventEmitter = function Fake() {}; f.existsSync = () => 'patched'; u.format = () => 'patched'; }")(events, fs, util);
  said.push(use(i));
}
console.log(said.join(" "));
