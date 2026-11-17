// A short substring that Map and Set lookups have found twice is resolved by the next lookup. One that is absent, or that was found less often, gives the same answers.
import { jscDescribe } from "bun:jsc";
const text = ["0123 name alpha beta gamma größe 日本語", "a_name_of_more_than_forty_eight_characters_that_is_never_hashed_again last"].join(" "), latin = ["0123 alpha beta größe", "gamma last"].join(" ");
const piece = (from: string) => { const base = from.charCodeAt(0) === 33 ? latin : text, part = base === latin ? from.slice(1) : from, at = base.indexOf(part); return base.substring(at, at + part.length); };
const narrowNames = ["0123", "gamma", "last", "!alpha", "!beta", "!größe", "!gamma"];
const isRope = (value: string) => jscDescribe(value).includes("rope");
const names = ["name", "alpha", "beta", "größe", "日本語", "a_name_of_more_than_forty_eight_characters_that_is_never_hashed_again"];
const narrow = new Map<string, number>(); const wide = new Map<any, any>([[1.5, "number"], [undefined, 0]]); const large = new Map<string, string>(); const set = new Set<string>(); const constant = new Map([["name", 1], ["beta", 2], ["größe", 3]]);
for (const name of names) { const key = name + ""; narrow.set(key, name.length); wide.set(key, { name }); large.set(key, key); set.add(key); }
for (let i = 0; i < 400; ++i) large.set("key" + i, "value" + i);
let log = "";
function ask(kind: string, find: (key: string) => unknown, rounds: number) {
    for (const name of [...names, ...narrowNames]) {
        const key = piece(name); let answers = "";
        for (let i = 0; i < rounds; ++i) answers += " " + JSON.stringify(find(key));
        log += kind + " " + name.slice(0, 8) + answers + " " + key.toLowerCase() + " " + key.length + (key === name) + "\n";
    }
}
for (const rounds of [1, 2, 3, 4, 9]) {
    ask("get", key => narrow.get(key), rounds); ask("has", key => narrow.has(key), rounds); ask("set", key => set.has(key), rounds); ask("both", key => narrow.has(key) ? narrow.get(key) : wide.get(key), rounds);
    ask("wide", key => wide.get(key), rounds); ask("wide has", key => wide.has(key), rounds); ask("large", key => large.get(key), rounds); ask("constant", key => constant.get(key), rounds); ask("constant has", key => constant.has(key), rounds);
    ask("turns", key => [narrow.get(key), constant.has(key), large.has(key), set.has(key), wide.get(key)], rounds);
}
// Found twice, then absent, then found again.
for (const name of ["name", "alpha", "größe"]) {
    const key = piece(name === "name" ? name : "!" + name); const other = new Map([[name + "x", 1]]); const same = new Map([[name + "", 5]]);
    const answers = [same.get(key), same.get(key), other.get(key), other.has(key), same.get(key), same.delete(key), same.get(key), same.has(key), same.set(key, 7).get(key), [...same.keys()].join()];
    log += JSON.stringify(answers) + "\n";
}
// The interpreter of a language looks a name up again and again.
class CaselessMap { map = new Map<string, number>(); has(key: string) { return this.map.has(key.toLowerCase()); } get(key: string) { return this.map.get(key.toLowerCase()); } set(key: string, value: number) { this.map.set(key.toLowerCase(), value); } }
class Reference { constructor(public name: string) {} value(state: CaselessMap) { return state.has(this.name) ? state.get(this.name)! : (state.set(this.name, 1), 1); } }
const state = new CaselessMap(); state.set("alp" + "ha", 2); state.set("be" + "ta", 3);
const references = ["alpha", "beta", "gamma"].map(name => new Reference(latin.substring(latin.indexOf(name), latin.indexOf(name) + name.length))); let sum = 0;
for (let i = 0; i < 1000; ++i) for (const reference of references) sum += reference.value(state);
for (const reference of references) log += reference.name.length + " " + isRope(reference.name) + "\n";
log += sum + " " + references.map(reference => reference.name).join() + "\n";
console.log(log);
