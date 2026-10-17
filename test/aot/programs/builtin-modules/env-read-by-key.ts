// process.env read by keys that are computed: set and not set, by the same strings again and again and by strings put together anew; then variables come and go.
const lines: string[] = [];
const constant = ["KEYED_READ_TEST_ALPHA", "KEYED_READ_TEST_BETA", "KEYED_READ_TEST_GAMMA", "KEYED_READ_TEST_DELTA"];
function fresh(index: number): string {
    return ["KEYED", "READ", "TEST", ["ALPHA", "BETA", "GAMMA", "DELTA"][index]!].join("_");
}
function ask(rounds: number, name: (index: number) => string): string {
    const seen: string[] = [];
    for (let round = 0; round < rounds; round++) {
        let line = "";
        for (let i = 0; i < 4; i++) {
            const value = process.env[name(i)];
            line += value === undefined ? "." : "[" + value + "]";
        }
        if (seen[seen.length - 1] !== line) seen.push(line);
    }
    return seen.join(" ");
}
const byConstant = (index: number) => constant[index]!;
lines.push("none is set: " + ask(6, byConstant) + " | " + ask(6, fresh));
process.env[fresh(0)] = "one";
lines.push("alpha: " + ask(6, byConstant) + " | " + ask(6, fresh));
process.env.KEYED_READ_TEST_BETA = "two";
lines.push("beta by name: " + ask(6, byConstant) + " | " + ask(6, fresh));
process.env[constant[2]!] = 3 as any;
lines.push("gamma, a number: " + ask(6, byConstant) + " | " + typeof process.env[constant[2]!]);
delete process.env[fresh(0)];
lines.push("alpha gone: " + ask(6, byConstant) + " | " + ask(6, fresh));
delete process.env.KEYED_READ_TEST_BETA;
delete process.env[constant[2]!];
lines.push("all gone: " + ask(6, byConstant) + " | " + ask(6, fresh));
lines.push("any set: " + constant.some(name => Boolean(process.env[name])));
process.env[constant[3]!] = "";
lines.push("delta, empty: " + ask(4, byConstant) + " any set: " + constant.some(name => Boolean(process.env[name])) + " in: " + (constant[3]! in process.env) + " " + (constant[0]! in process.env));
delete process.env[constant[3]!];
for (let i = 0; i < 90; i++) process.env["KEYED_READ_TEST_MANY_" + i] = String(i);
lines.push("ninety more: " + ask(6, byConstant) + " | " + ask(6, fresh) + " | " + process.env["KEYED_READ_TEST_MANY_" + 89]);
process.env[fresh(1)] = "late";
lines.push("beta again: " + ask(6, byConstant) + " | " + ask(6, fresh));
delete process.env[constant[1]!];
lines.push("and gone: " + ask(6, byConstant) + " | " + ask(6, fresh));
for (let i = 0; i < 90; i++) delete process.env["KEYED_READ_TEST_MANY_" + i];
lines.push("the ninety gone: " + ask(6, byConstant) + " | " + String(process.env["KEYED_READ_TEST_MANY_" + 5]));
lines.push("what every object has: " + typeof process.env["toString"] + " " + typeof process.env[["has", "Own", "Property"].join("")] + " " + String(process.env["constructor"] === Object));
let total = 0;
for (let turn = 0; turn < 30000; turn++) {
    if (turn === 10000) process.env[constant[2]!] = "x";
    if (turn === 20000) delete process.env[constant[2]!];
    if (process.env[turn & 1 ? constant[turn & 3]! : fresh(turn & 3)] !== undefined) total++;
}
lines.push("in a long loop: " + total);
console.log(lines.join("\n"));
