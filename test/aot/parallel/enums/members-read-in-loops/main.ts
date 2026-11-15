// `State.Ready` in a loop, State an enum that is handed on and whose members other code may store into: its object is found in front of the loop, and the loop runs as it is written where it is not made yet.
// STATISTIC: ModuleConstantReadsHoisted >= 4
import { Level, State } from "./kinds";
import { count, readsBeforeItIsMade } from "./early";

const registry: any[] = [];
function register(held: any) {
  registry.push(held);
  return held;
}
function replace(held: any, by: number) {
  held.Ready = by;
  held.High = by;
}
register(State);
register(Level);
const list = [1, 2, 3, 2, 0, 5];
console.log(readsBeforeItIsMade(list), count(list), count([]));

function name(state: number): string {
  switch (state) {
    case State.Waiting:
      return "waiting";
    case State.Ready:
      return "ready";
    case State.Done:
      return "done";
  }
  return "none";
}
let lengths = 0;
for (let turn = 0; turn < 3; turn++) for (let i = 0; i < 6; i++) lengths += name(i % 5).length;
console.log(lengths);

function nest(rows: number[][]): number {
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    for (let k = 0; k < row.length; k++) if (row[k] === State.Ready) sum += State.Done;
  }
  return sum;
}
console.log(nest([[2, 2, 1], [], [3, 2]]), nest([]), nest([[]]));

const trapped = new Proxy({} as Record<string, number>, {
  get(_, key) {
    let found = 0;
    for (let i = 0; i < list.length; i++) if (list[i] === State.Ready || list[i] === Level.High) found += String(key).length;
    return found;
  },
});
console.log(trapped.ab, trapped.abcd);

const pairs = [{ kinds: [1, 2] }, { kinds: [2, 2] }, { kinds: [3] }];
let seen = "";
pairs.forEach(({ kinds: [first, ...others] }) => {
  for (let i = 0; i < others.length; i++) seen += others[i] === State.Ready ? "r" : "-";
  seen += first === State.Done ? "d" : ".";
});
console.log(seen);

function* steps(limit: number) {
  for (let i = 0; i < limit; i++) yield i === State.Ready ? "ready" : i;
}
console.log([...steps(4)].join());

function changesInTurns(values: number[], at: number): string {
  let text = "";
  for (let i = 0; i < values.length; i++) {
    if (i === at) replace(registry[0], 7);
    text += values[i] === State.Ready ? "r" : "-";
  }
  return text;
}
console.log(changesInTurns(list, -1));
console.log(changesInTurns([2, 2, 7, 2, 7], 2));
console.log(count(list), count([7, 7, 3]), name(7), name(2), nest([[7], [2]]), trapped.ab);
replace(registry[0], 2);
replace(registry[1], 5);
console.log(count(list), trapped.ab, State.Ready, Level.High, Object.keys(Level).length);
