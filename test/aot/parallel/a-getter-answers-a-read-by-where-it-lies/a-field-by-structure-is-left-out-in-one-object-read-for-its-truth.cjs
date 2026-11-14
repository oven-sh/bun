const turns = Number(process.argv[2] ?? 60000), hide = value => [value][JSON.parse("0")];
function look(one) { return one.mark ? 3 : 4; }
function P(k) { this.n = 0; if (k) this.mark = k; } function Q(k) { this.n = 0; this.q = 1; if (k) this.mark = k; }
const all = hide([new P(5), new Q(7), new Q(0)]);
const looks = hide(look), name = hide("mark");
let sum = 0, wrong = 0;
for (let turn = 0; turn < turns; turn++) {
    const one = all[turn % all.length];
    const said = looks(one);
    sum += said === undefined ? -1 : said;
    if (turn % 991 === 0 && said !== (Reflect.get(one, name) ? 3 : 4)) wrong++;
}
console.log("SAID", sum, wrong);
