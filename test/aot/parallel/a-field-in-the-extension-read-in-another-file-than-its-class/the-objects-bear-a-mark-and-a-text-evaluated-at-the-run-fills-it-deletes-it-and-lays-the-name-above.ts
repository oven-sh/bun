import { Seldom, Rarely } from "./lib-seldom.ts";
const turns = Number(process.argv[2] ?? 60000), half = turns >> 1, hide = <T,>(value: T): T => [value][JSON.parse("0")];
function read(one: any) { return one.wanted; }
const looks = hide(read), name = hide("wanted"), all: any[] = hide([]);
const tell = (value: any) => value === undefined ? -1 : typeof value === "number" ? value : typeof value === "string" ? value.length + 1000 : typeof value === "object" ? 50 + value.before : -7;
for (let at = 0; at < 8; at++) all.push(new Seldom(at + 10, at % 3 !== 1));
all.push(new Rarely(true), new Rarely(false), JSON.parse("{\"wanted\":9}"));
const first = (0, eval)(`(function (all) { for (const one of all) Object.defineProperty(one, "beside", { get() { return 3; }, configurable: true }); })`), change = (0, eval)(`(function (all) { all[1].wanted = "late"; Object.getPrototypeOf(all[4]).wanted = 7000; all[0].wanted = all[2]; delete all[3].wanted; Object.defineProperty(all[5], "wanted", { get() { return 88; }, configurable: true }); })`);
first(all);
let sum = 0, wrong = 0;
for (let turn = 0; turn < turns; turn++) {
    if (turn === half) change(all);
    const one = all[turn % all.length], value = looks(one);
    sum += tell(value);
    if ((turn % 499 === 0 || (turn >= half && turn < half + 96)) && Reflect.get(one, name) !== value) wrong++;
}
console.log("SAID", sum, wrong);
