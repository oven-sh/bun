function lengthOf(value) { return value.length; }
function lengthOfSecond(first, value) { return value.length; }
function lengthOfThird(first, second, value) { return value.length; }
function ofBoth(left, right) { return left.length * 1000 + right.length; }

function texts(round) {
    const digits = String(round * 1234567);
    const rope = "left " + digits + " right " + digits;
    const ropeOfRopes = rope + rope + digits;
    const ropeOfThree = digits + "-" + digits;
    const resolved = "seen " + digits + " twice"; resolved.charCodeAt(3);
    const wide = "αβγ" + digits;
    const wideResolved = "中" + digits + "😀"; wideResolved.codePointAt(0);
    const long = "0123456789".repeat(40 + round);
    const part = long.slice(7, 200 + round);
    const partOfRope = (long + digits).substring(3, 390);
    const partOfPart = part.slice(2, 50);
    const one = long[round % 10];
    const joined = ["a", digits, "b"].join("/");
    const padded = digits.padStart(30, ".");
    const upper = ("mixed " + digits).toUpperCase();
    const fromCodes = String.fromCharCode(65 + round, 66, 0x2603);
    const template = `${digits}:${round}:${one}`;
    const replaced = long.replace("345", digits);
    const parsed = JSON.parse('{"name":"value ' + digits + '"}').name;
    const key = Object.keys({ ["key" + digits]: 1 })[0];
    const trimmed = ("   " + digits + "  ").trim();
    return ["", "a", "text", digits, rope, ropeOfRopes, ropeOfThree, resolved, wide, wideResolved, long, part, partOfRope, partOfPart, one, joined, padded, upper, fromCodes, template, replaced, parsed, key, trimmed, typeof round, (12.5 + round).toString(), Symbol("named " + digits).description];
}

let sum = 0;
for (let round = 0; round < 4; round++) {
    const all = texts(round);
    const lines = [];
    for (let index = 0; index < all.length; index++) {
        const text = all[index];
        const other = all[(index + 5) % all.length];
        lines.push(lengthOf(text) + " " + lengthOfSecond(round, text) + " " + lengthOfThird(round, other, text) + " " + ofBoth(text, other) + " " + ofBoth(other, [text, other]));
        sum += lengthOf(text);
    }
    console.log(round + ": " + lines.join(" | "));
}
for (const odd of [new String("boxed text"), Object("wrapped"), { length: "own" }, [], ["x"], [1], [1.5], null, undefined, 7, true, 10n, Symbol.iterator]) {
    let said;
    try { said = typeof lengthOf(odd) + " " + String(lengthOf(odd)); } catch (error) { said = error.constructor.name; }
    console.log(said);
}
console.log(sum);
