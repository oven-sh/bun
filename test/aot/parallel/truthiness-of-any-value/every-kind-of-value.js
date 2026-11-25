// Every kind of value, asked for its truthiness where nothing is known of it: as the condition of a branch and as a boolean that is kept.
const empty = ["", "a"][Date.now() > 0 ? 0 : 1];
const text = ["", "abcdefgh"][Date.now() > 0 ? 1 : 0];
const zero = Date.now() > 0 ? 0 : 1;
const values = [
    ["undefined", undefined], ["null", null], ["false", false], ["true", true],
    ["0", 0], ["-0", -0], ["1", 1], ["-1", -1], ["2147483647", 2147483647], ["-2147483648", -2147483648],
    ["0.5", 0.5], ["-0.5", -0.5], ["NaN", NaN], ["-NaN", -NaN], ["0 / 0", zero / zero], ["Infinity", Infinity], ["-Infinity", -Infinity],
    ["5e-324", 5e-324], ["-5e-324", -5e-324], ["1e-320", 1e-320], ["2.2250738585072014e-308", 2.2250738585072014e-308],
    ["1.7976931348623157e308", 1.7976931348623157e308], ["-1.7976931348623157e308", -1.7976931348623157e308],
    ["4294967296", 4294967296], ["-4294967296", -4294967296], ["2147483648", 2147483648], ["-2147483649", -2147483649], ["9007199254740993", 9007199254740993],
    ["zero * -1", zero * -1], ["zero * 0.5", zero * 0.5], ["Math.sqrt(-1)", Math.sqrt(-1 - zero)], ["1 / zero", 1 / zero], ["-1 / zero", -1 / zero],
    ["empty text", ""], ["text", "a"], ["empty + empty", empty + empty], ["a slice of nothing", text.slice(3, 3)], ["repeated no times", text.repeat(zero)],
    ["a rope", text + text + text], ["a rope with an empty part", text + empty + text], ["text of zero", "0"], ["text of false", "false"], ["a blank", " "],
    ["a symbol", Symbol()], ["a named symbol", Symbol("")], ["a well-known symbol", Symbol.iterator],
    ["0n", 0n], ["-0n", -0n], ["1n", 1n], ["-1n", -1n], ["0n * 5n", BigInt(zero) * 5n], ["1n - 1n", BigInt(zero + 1) - 1n], ["2n ** 70n", 2n ** 70n], ["-(2n ** 70n)", -(2n ** 70n)],
    ["an object", {}], ["a list", []], ["a function", function () {}], ["an arrow", () => 0], ["a class", class {}],
    ["new Boolean(false)", new Boolean(false)], ["new Number(0)", new Number(0)], ["new String(\"\")", new String("")], ["Object(0n)", Object(0n)],
    ["a regular expression", /x/], ["a date", new Date(0)], ["without a prototype", Object.create(null)], ["a proxy", new Proxy({}, {})], ["a map", new Map()], ["bytes", new Uint8Array(0)],
    ["a promise", Promise.resolve(0)], ["an error", new Error("")], ["the global object", globalThis], ["arguments", (function () { return arguments; })()],
];

function asBranch(value) {
    if (value)
        return "truthy";
    return "falsy";
}

function asBoolean(value) {
    const answer = !!value;
    return [answer, typeof answer];
}

function negated(value) {
    return !value ? "falsy" : "truthy";
}

function inConjunction(value, other) {
    return (value && other) === other ? "went on" : "stopped";
}

function inDisjunction(value, other) {
    return (value || other) === other ? "went on" : "stopped";
}

function asCondition(value) {
    return value ? 1 : 2;
}

const marker = {};
for (const [name, value] of values) {
    const kept = asBoolean(value);
    console.log(name, asBranch(value), kept[0], kept[1], negated(value), inConjunction(value, marker), inDisjunction(value, marker), asCondition(value), Boolean(value));
}
