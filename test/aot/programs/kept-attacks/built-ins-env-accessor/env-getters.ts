// env-getters.ts <form> <rounds>: an object of getters that a loop defines over process.env, read by name and by key; and the pieces of such a read by themselves.
const keys = ["HOME", "PATH", "USER", "SHELL", "LANG", "TERM", "MODEL_NOT_SET_A", "MODEL_NOT_SET_B"] as const;
type Env = { readonly [K in (typeof keys)[number]]: string | undefined };
const env = {} as Env;
for (const key of keys) Object.defineProperty(env, key, { get() { return process.env[key]; }, enumerable: true, configurable: true });

function byName(): number {
    return (env.HOME ? 1 : 0) + (env.PATH ? 1 : 0) + (env.USER ? 1 : 0) + (env.SHELL ? 1 : 0) + (env.LANG ? 1 : 0) + (env.TERM ? 1 : 0) + (env.MODEL_NOT_SET_A ? 1 : 0) + (env.MODEL_NOT_SET_B ? 1 : 0);
}
function byKey(): number {
    let n = 0;
    for (const key of keys) if (env[key]) n++;
    return n;
}
function direct(): number {
    return (process.env.HOME ? 1 : 0) + (process.env.PATH ? 1 : 0) + (process.env.USER ? 1 : 0) + (process.env.SHELL ? 1 : 0) + (process.env.LANG ? 1 : 0) + (process.env.TERM ? 1 : 0) + (process.env.MODEL_NOT_SET_A ? 1 : 0) + (process.env.MODEL_NOT_SET_B ? 1 : 0);
}
function directByKey(): number {
    let n = 0;
    for (const key of keys) if (process.env[key]) n++;
    return n;
}
const held = process.env;
function heldByKey(): number {
    let n = 0;
    for (const key of keys) if (held[key]) n++;
    return n;
}
const plain: Record<string, string | undefined> = { ...process.env };
const overPlain = {} as Env;
for (const key of keys) Object.defineProperty(overPlain, key, { get() { return plain[key]; }, enumerable: true, configurable: true });
function gettersOverPlainObject(): number {
    return (overPlain.HOME ? 1 : 0) + (overPlain.PATH ? 1 : 0) + (overPlain.USER ? 1 : 0) + (overPlain.SHELL ? 1 : 0) + (overPlain.LANG ? 1 : 0) + (overPlain.TERM ? 1 : 0) + (overPlain.MODEL_NOT_SET_A ? 1 : 0) + (overPlain.MODEL_NOT_SET_B ? 1 : 0);
}
const constant = {} as Env;
for (const key of keys) Object.defineProperty(constant, key, { get() { return key; }, enumerable: true, configurable: true });
function gettersThatAnswerTheirKey(): number {
    return (constant.HOME ? 1 : 0) + (constant.PATH ? 1 : 0) + (constant.USER ? 1 : 0) + (constant.SHELL ? 1 : 0) + (constant.LANG ? 1 : 0) + (constant.TERM ? 1 : 0) + (constant.MODEL_NOT_SET_A ? 1 : 0) + (constant.MODEL_NOT_SET_B ? 1 : 0);
}
function nothing(): number { return 6; }
const forms: Record<string, () => number> = { byName, byKey, direct, directByKey, heldByKey, gettersOverPlainObject, gettersThatAnswerTheirKey, nothing };
const [form, roundsText] = process.argv.slice(2);
const run = forms[form];
const rounds = Number(roundsText) | 0;
let sum = 0;
for (let r = 0; r < rounds; r++) sum += run();
console.log(form, sum > 0);
