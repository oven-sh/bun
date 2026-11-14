const turns = Number(process.argv[2] ?? 60000), hide = value => [value][JSON.parse("0")];
function fill(object, count, tag) { for (let at = 0; at < count; at++) object[tag + at] = at; }
function look(one) { return one.mark ? 3 : 4; }
const first = JSON.parse('{"n":0}'), second = JSON.parse('{"n":0}'), other = JSON.parse('{"n":0,"q":1}');
fill(first, 14, "o"); fill(second, 14, "o"); fill(other, 17, "o");
for (const [each, base] of [[first, 99], [second, 99], [other, 200]]) Object.defineProperty(each, "mark", { get() { return (base + this.n) % 3; }, configurable: true });
const all = hide(turns < 0 ? [other] : [first, second]);
const looks = hide(look), name = hide("mark");
let sum = 0, wrong = 0;
for (let turn = 0; turn < turns; turn++) {
    const one = all[turn % all.length];
    one.n = turn % 3;
    const said = looks(one);
    sum += said;
    if (turn % 991 === 0 && said !== (Reflect.get(one, name) ? 3 : 4)) wrong++;
}
console.log("SAID", sum, wrong);
