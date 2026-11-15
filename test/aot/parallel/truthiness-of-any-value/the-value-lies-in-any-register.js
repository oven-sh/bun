// Many values are alive at once, so each is asked where it happens to lie, and all of them are read again behind the questions.
const zero = Date.now() > 0 ? 0 : 1;
const kinds = [undefined, null, false, true, 0, 7, -0, 0.25, zero / zero, "", "text", "text" + String(zero) + "more", Symbol.iterator, 0n, 3n, {}, [], () => 0];

function name(value) {
    return typeof value === "symbol" ? "symbol" : typeof value === "bigint" ? value + "n" : typeof value === "function" ? "function" : Object.is(value, -0) ? "-0" : typeof value === "object" && value ? (Array.isArray(value) ? "list" : "object") : typeof value === "string" ? JSON.stringify(value) : String(value);
}

function branches(a, b, c, d, e, f, g, h, i, j) {
    let answers = "";
    if (j) answers += "j";
    if (i) answers += "i";
    if (h) answers += "h";
    if (g) answers += "g";
    if (f) answers += "f";
    if (e) answers += "e";
    if (d) answers += "d";
    if (c) answers += "c";
    if (b) answers += "b";
    if (a) answers += "a";
    return [answers, a, b, c, d, e, f, g, h, i, j];
}

function booleans(a, b, c, d, e, f, g, h, i, j) {
    const first = !!a, second = !!b, third = !!c, fourth = !!d, fifth = !!e, sixth = !!f, seventh = !!g, eighth = !!h, ninth = !!i, tenth = !!j;
    return [[first, second, third, fourth, fifth, sixth, seventh, eighth, ninth, tenth].map(Number).join(""), a, b, c, d, e, f, g, h, i, j];
}

function counted(a, b, c, d, e, f) {
    let count = 0;
    if (a && b) count += 1;
    if (c || d) count += 2;
    if (!e) count += 4;
    if (f ? a : b) count += 8;
    if (!(c && !d)) count += 16;
    return [count, f, e, d, c, b, a];
}

for (let shift = 0; shift < kinds.length; ++shift) {
    const at = index => kinds[(shift + index * 5) % kinds.length];
    const first = branches(at(0), at(1), at(2), at(3), at(4), at(5), at(6), at(7), at(8), at(9));
    const second = booleans(at(0), at(1), at(2), at(3), at(4), at(5), at(6), at(7), at(8), at(9));
    const third = counted(at(0), at(1), at(2), at(3), at(4), at(5));
    console.log(first[0], first.slice(1).map(name).join(" "));
    console.log(second[0], second.slice(1).map(name).join(" "));
    console.log(third[0], third.slice(1).map(name).join(" "));
}
