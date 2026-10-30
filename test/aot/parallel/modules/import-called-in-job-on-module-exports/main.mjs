// The entry point imports a module that holds nothing but an export. Two jobs call import() on it, beside a chain of jobs that shows in which turn each promise settles.
import "./known.mjs";
let turns = Promise.resolve();
for (let turn = 1; turn < 24; turn++)
  turns = turns.then(() => {
    console.log(turn);
    if (turn === 2 || turn === 12) import("./known.mjs").then(() => console.log("asked for in turn " + turn));
  });
