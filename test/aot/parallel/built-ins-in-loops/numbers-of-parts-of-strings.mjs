// Number(part), +part, part * 1 of substrings that are not resolved: digits, words, signs, spaces, hexadecimal, wide characters, nothing at all.
const log = [];
const texts = ["1.22.333", "0007,12,9007199254740993,123456789012345", "-1 +2 -0", "0x10;0b11;1e3", "  4  ; 5;;", "жук 77 жук", "Infinity;NaN;word;9a", "12345678;123456789;1234567890123456"];
function parts(text, separator) {
    return text.split(separator);
}
for (let turn = 0; turn < 3; turn++)
    for (const text of texts)
        for (const separator of [".", ",", " ", ";", ""])
            for (const part of parts(text, separator)) {
                const cut = text.slice(1, 1 + part.length);
                log.push(Number(part), +cut, part * 1, cut - 0, part > 3, ~part, parts(text, separator).map(Number).length);
            }
console.log(log.length, log.map(String).join(" ").slice(0, 6000));
let sum = 0;
for (const value of log) if (typeof value === "number" && Number.isFinite(value)) sum += value % 1000;
console.log(sum, log.filter(Number.isNaN).length, Object.is(Number("x-0".slice(1)), -0));
