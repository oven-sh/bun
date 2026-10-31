import { center } from "./callers/center.js";
import { east } from "./callers/east.js";
import { halfSeen, log, names, seen, unseen } from "./callers/liar.js";
import { north } from "./callers/north.js";
import { south } from "./callers/south.js";
import { west } from "./callers/west.js";
import { attempt, show } from "./show.js";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

const honest = () => [north(), south(), east(), west(), center()];
attempt("the liar goes first", () => seen("texts"));
attempt("honest", honest);
for (let i = 0; i < 2000; i++) honest();
for (const [way, call] of Object.entries({ seen, halfSeen, unseen })) {
  for (const name of names) {
    log.length = 0;
    attempt(way + " " + name, () => call(name));
    if (log.length) console.log(way + " " + name + " ran", log.join(", "));
  }
}
attempt("honest again", honest);
