const turns = Number(process.argv[2] ?? 60000), hide = value => [value][JSON.parse("0")];
function look(one) { return one.byteLength; }
const all = hide([new Uint8Array(0), new Uint8Array(3)]);
const looks = hide(look), name = hide("byteLength");
let sum = 0, wrong = 0;
for (let turn = 0; turn < turns; turn++) {
    const one = all[turn % all.length];
    const said = looks(one);
    sum += said === undefined ? -1 : said;
    if (turn % 991 === 0 && said !== Reflect.get(one, name)) wrong++;
}
console.log("SAID", sum, wrong);
