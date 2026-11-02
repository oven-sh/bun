// COUNT: operation:operationAOTStringHasAt >= 30000
// COUNT: flattened:RopesForPrefixTests <= 400
const log = [];
const show = (label, value) => log.push(label + ": " + JSON.stringify(value));

const questions = {
    starts: (text, other) => text.startsWith(other),
    ends: (text, other) => text.endsWith(other),
    startsAtOne: (text, other) => text.startsWith(other, 1),
    endsBeforeLast: (text, other) => text.endsWith(other, text.length - 1),
};
const names = Object.keys(questions);
function ask(name, text, other) {
    return questions[name](text, other);
}
function askAll(text, other) {
    return names.map(name => ask(name, text, other) ? 1 : 0).join("");
}

const texts = ["core.editor=vi", "core.editor", "=", "", "xcore.editor=vi", "core.editor=vix", "é.中=文", "xé.中=文", "é.中=文x", "core.中=vi"];
const keys = ["core.editor", "core", "", "é.中", "é", "中", "core.中", "xcore.editor"];
for (const text of texts) {
    for (const key of keys) {
        show(`${text} | ${key}`, [
            askAll(text, key + "="),
            askAll(text, key + "=" + "vi"),
            askAll(text, "=" + key),
            askAll(text, `${key}=文`),
            askAll(text, key + "=" + text.slice(text.indexOf("=") + 1)),
        ]);
    }
}

let deep = "";
let flat = "";
for (let i = 0; i < 60; i++) {
    deep = i & 1 ? deep + ("p" + i) : ("q" + i) + deep;
    flat = i & 1 ? flat.concat("p", i) : "q".concat(i, flat);
}
const long = [flat, "tail"].join("");
show("deep", [askAll(long, deep), askAll("x" + long, deep), askAll(flat, deep + "t"), askAll(long, deep + "t"), askAll(long, deep + "x")]);

const page = "a long page of text, of which pieces are cut: core.editor=vi and more of it";
const at = page.indexOf("core");
show("cut", [askAll("core.editor=vi", page.slice(at, at + 11) + "="), askAll("core.editor=vi", page.slice(at, at + 11) + page.slice(at + 11, at + 14)), askAll("core.editor=vi", page.slice(at, at + 5) + page.slice(at + 4, at + 14))]);

const kept = keys[0] + "=";
show("kept", [askAll(texts[0], kept), askAll(texts[1], kept), askAll(texts[4], kept), kept.length, kept]);
const both = texts[0] + "!";
show("both", [askAll(both, both), askAll(texts[0] + "!", keys[0] + "="), askAll(texts[0] + "!", "vi" + "!")]);

let given = 0;
const pairs = ["core.editor=vi", "user.name=x", "core.pager=", "gc.auto=0"];
const settings = [];
for (let i = 0; i < 25; i++)
    settings.push("core.setting" + i, i % 5 ? "gc.auto" : "core.pager");
for (let round = 0; round < 200; round++) {
    for (const key of settings) {
        for (const pair of pairs) {
            if (ask(round & 1 ? "starts" : "ends", pair, round & 1 ? key + "=" : "=" + round % 3))
                given++;
        }
    }
}
show("given", given);
console.log(log.join("\n"));
