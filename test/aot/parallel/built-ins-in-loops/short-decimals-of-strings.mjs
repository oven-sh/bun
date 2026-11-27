// Number(text), +text, text * 1 of signs, points and digits: the quotient of two exact integers is the number that is nearest.
const log = [];
const words = ["", ".", "-", "-.", "+", "5.", ".5", "-5", "-0", "-0.0", "-.5", "-5.", "1..2", "1.2.3", "1.2e3", "0.1", "0.2", "0.30000000000000", "123456789.12345", "99999999999999.9", "-99999999999.99", "0.000000000001", "I", "Infinity", "-Infinity", "infinity", "Inf", "e5", "x", "0x1f", "1_0", "1,5", " 1.5", "1.5 ", "\t-2.5\n", "1.5f", "--1", "+-1", "+1.5", "007.50", "00", "9007199254740993", "4503599627370497.5", "жук", "1.5ж"];
const id = value => [value][0];
function read(text) {
    return [Number(text), +text, text * 1, text - 0, text / 2, text | 0, ~text, Number(id(text)), Math.max(text, 0)];
}
for (let turn = 0; turn < 3; turn++)
    for (const word of words) {
        const part = ("[" + word + "]").slice(1, -1);
        const joined = word.slice(0, 2) + word.slice(2);
        for (const text of [word, part, joined]) log.push(read(text).map(value => (Object.is(value, -0) ? "-0" : String(value))).join());
    }
let wrong = 0;
for (let i = 0; i < 3000; i++) {
    const digits = String((i * 7919 + 13) % 100003) + "." + String((i * 104729) % 1000003);
    if (Number(digits) !== JSON.parse(digits) || Number("-" + digits) !== -JSON.parse(digits)) wrong++;
}
console.log(log.slice(0, words.length * 3).join("\n"));
console.log(log.length, wrong);
