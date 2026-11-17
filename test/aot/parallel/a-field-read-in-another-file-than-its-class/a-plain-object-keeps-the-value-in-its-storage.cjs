require("./lib-kinds.cjs");
const turns = Number(process.argv[2] ?? 60000), half = turns >> 1, hide = value => [value][JSON.parse("0")];
function read(one) { return one.wanted; }
const looks = hide(read), name = hide("wanted"), all = hide([]);
const tell = value => value === undefined ? -1 : typeof value === "number" ? value : typeof value === "string" ? value.length + 1000 : -7;
let sum = 0, wrong = 0;
const text = "{" + Array.from({ length: 40 }, (_, at) => JSON.stringify("k" + at) + ":" + at).join(",") + ",\"wanted\":77,\"behind\":78}";
for (let at = 0; at < 8; at++) { const one = JSON.parse(text); one.wanted += at; all.push(one); }
const change = (0, eval)("(function (one, other) { one.wanted = \"anew\"; delete other.wanted; })");
for (let turn = 0; turn < turns; turn++) {
    if (turn === half) { change(all[1], all[4]); }
    const one = all[turn % all.length], value = looks(one);
    sum += tell(value);
    if ((turn % 499 === 0 || (turn >= half && turn < half + 96)) && Reflect.get(one, name) !== value) wrong++;
}
console.log("SAID", sum, wrong);
