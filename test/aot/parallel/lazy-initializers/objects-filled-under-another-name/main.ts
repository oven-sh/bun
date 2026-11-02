// An object that a binding holds is filled through another name for it: the one of two that a condition chose, what a switch chose, what `||` or `??` let through. Whoever reads the binding finds it filled.
import { count, flag } from "./flags";

const table: Record<string, () => number> = {};
const spare: Record<string, () => number> = {};
const target = flag ? spare : table;
const one = () => 1, two = () => 2, three = () => 3;
target.one = one; target.two = two; target.three = three;
export function namesOfTable() { return Object.keys(table).join() + " | " + Object.keys(spare).join(); }
export function callTable() { return one() + two() + three(); }

const first: Record<string, () => string> = {};
const second: Record<string, () => string> = {};
const third: Record<string, () => string> = {};
let picked: Record<string, () => string>;
switch (count) {
  case 1: picked = first; break;
  case 2: picked = second; break;
  default: picked = third;
}
const red = () => "red", green = () => "green", blue = () => "blue";
picked.red = red; picked.green = green; picked.blue = blue;
export function namesOfThree() { return [first, second, third].map(each => Object.keys(each).join()).join(" | "); }
export function callThree() { return red() + green() + blue(); }

const kept: { list: (() => number)[] } = { list: [] };
const fallback: { list: (() => number)[] } = { list: [] };
const through = (flag ? undefined : kept) ?? fallback;
const four = () => 4, five = () => 5, six = () => 6;
through.list = [four, five, six];
export function lengths() { return kept.list.length + " | " + fallback.list.length; }
export function callList() { return four() + five() + six(); }

namespace States {
  export function enter() { return "enter"; }
  export function leave() { return "leave"; }
  export function next(state: () => string) { return state === enter ? leave : enter; }
}
export function walk() { let state: () => string = States.enter; const seen = []; for (let i = 0; i < 3; i++) { seen.push(state()); state = States.next(state); } return seen.join(); }

console.log(namesOfTable());
console.log(namesOfThree());
console.log(lengths());
console.log(walk());
console.log(callTable(), callThree(), callList());
console.log(namesOfTable(), namesOfThree(), lengths());
