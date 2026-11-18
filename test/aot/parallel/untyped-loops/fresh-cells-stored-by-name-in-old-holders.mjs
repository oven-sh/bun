import { edenGC, fullGC } from "bun:jsc";

const count = 128;
const holders = JSON.parse("[" + Array(count).fill('{"n":0,"m":0,"k":1.5}').join(",") + "]");

function move(to, from, turns) {
  for (let i = 0; i < turns; i++) {
    to.n = from.m;
    to.k = from.k;
  }
  return turns;
}

function exchange(to, from, turns) {
  for (let i = 0; i < turns; i++) {
    const held = to.n;
    to.n = from.m;
    from.m = held;
  }
  return turns;
}

function makeSource(k, round) {
  return JSON.parse('{"n":0,"m":{"text":"value ' + round + " " + k + '","list":[' + k + "," + round + ']},"k":' + (k & 1 ? "7" : '{"text":"key ' + k + '"}') + "}");
}

function fill(round, step) {
  let turns = 0;
  for (let k = 0; k < count; k++) turns += step(holders[k], makeSource(k, round), 9);
  return turns;
}

function occupy(round) {
  const made = [];
  for (let k = 0; k < 4000; k++) made.push(JSON.parse('{"text":"other ' + round + " " + k + '","list":[-1,-2]}'));
  return made.length;
}

let wrong = 0;
let answers = "";
for (let round = 0; round < 6; round++) {
  fullGC();
  const turns = fill(round, round & 1 ? exchange : move);
  edenGC();
  const occupied = occupy(round);
  edenGC();
  let right = 0;
  for (let k = 0; k < count; k++) {
    const { n, k: key } = holders[k];
    if (n.text === "value " + round + " " + k && n.list[0] === k && n.list[1] === round) right++;
    else wrong++;
    if (!(round & 1) && (k & 1 ? key !== 7 : key.text !== "key " + k)) wrong++;
  }
  answers += round + ":" + turns + ":" + occupied + ":" + right + " ";
}
console.log(answers + "wrong " + wrong);
