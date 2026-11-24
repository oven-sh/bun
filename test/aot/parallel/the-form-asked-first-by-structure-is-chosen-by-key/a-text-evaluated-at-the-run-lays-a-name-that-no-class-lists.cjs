const { Kept, Sparse } = require("./lib-listed.cjs");
const turns = Number(process.argv[2] ?? 60000), hide = value => [value][JSON.parse("0")];
function read(one) { return one.laidLate; }
const looks = hide(read), name = hide("laidLate"), all = hide([]);
const tell = value => value === undefined ? -1 : typeof value === "number" ? value : typeof value === "string" ? value.length + 1000 : -7;
for (let at = 0; at < 4; at++) all.push(new Kept(at, at), new Sparse(at, at % 2 === 0), JSON.parse("{\"x\":" + at + "}"));
const steps = (0, eval)(`[
    all => { for (const one of all) one.laidLate = 500; },
    all => { delete all[0].laidLate; delete all[2].laidLate; all[1].laidLate = "anew"; },
    all => { Object.defineProperty(all[3], "laidLate", { get() { return 88; }, configurable: true }); Object.getPrototypeOf(all[0]).laidLate = 7000; },
    all => { for (const one of all) delete one.laidLate; },
    all => { delete Object.getPrototypeOf(all[0]).laidLate; },
]`);
let laid = 0, notLaid = 0, wrong = 0;
const stretch = Math.max(1, Math.floor(turns / (steps.length + 1)));
for (let turn = 0; turn < turns; turn++) {
    if (turn % stretch === 0 && turn / stretch >= 1 && turn / stretch <= steps.length) steps[turn / stretch - 1](all);
    const one = all[turn % all.length], value = looks(one);
    if (value === undefined) notLaid++; else laid += tell(value);
    if ((turn % 499 === 0 || turn % stretch < 96) && Reflect.get(one, name) !== value) wrong++;
}
console.log("SAID", laid, notLaid, wrong);
