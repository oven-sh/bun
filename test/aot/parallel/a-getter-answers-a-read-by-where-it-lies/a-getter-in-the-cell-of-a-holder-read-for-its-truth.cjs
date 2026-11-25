const turns = Number(process.argv[2] ?? 60000), hide = value => [value][JSON.parse("0")];
function fill(object, count, tag) { for (let at = 0; at < count; at++) object[tag + at] = at; }
function look(one) { return one.mark ? 3 : 4; }
function P() { this.n = 0; } function Q() { this.n = 0; this.q = 1; }
for (const [each, base] of [[P, 99], [Q, 200]]) Object.defineProperty(each.prototype, "mark", { get() { return (base + this.n) % 3; }, configurable: true });
const all = hide(turns < 0 ? [new Q] : [new P, new P]);
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
