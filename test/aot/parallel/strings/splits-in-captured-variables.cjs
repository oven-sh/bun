// A list that a split makes, that closures capture, and that the same function stores into has storage of its own from the start.
// STATISTIC: StringsSplitWithOwnStorage >= 2
const log = [];
const id = v => [v][0];
const kept = [];
function format(text) {
    var parts = text.split("");
    var place = 0;
    function a() { return parts.length; }
    function b() { return parts[0] + "b"; }
    kept.push(a, b, () => parts, v => { parts = v; });
    while (parts[place]) {
        if (parts[place] === "a" || parts[place] === "b") parts[place] = eval(parts[place] + "()");
        place++;
    }
    return parts.join("") + parts.length;
}
function swap(text, by) {
    let parts = text.split(by);
    kept.push(() => parts, () => parts, () => parts, v => { parts = v; });
    for (let i = 0; i < parts.length; i++) parts[i] = parts[i] + i;
    const before = parts;
    kept[kept.length - 1](text.split(by));
    parts[0] = "second";
    return JSON.stringify([before, parts, text.split(by)]);
}
const texts = ["a-b", "", "xyz", "Y-m-d a b", "жa日b", id("a") + id("b"), id("xxaby").slice(1, 4), "b".repeat(12), 12, null, undefined, { split: () => ["own", "a"] }];
const attempt = f => { try { log.push(f()); } catch (e) { log.push(e.name + ": " + e.message); } };
for (let turn = 0; turn < 2; turn++)
    for (const text of texts) {
        attempt(() => format(text));
        attempt(() => format(format(text)));
        for (const by of [",", "", "-", /a/, undefined]) attempt(() => swap(text, by));
        attempt(() => kept.slice(-4).map(f => { const shown = f(["z"]); return Array.isArray(shown) ? shown.join("/") : String(shown); }).join());
    }
for (let k = 0; k < kept.length; k += 5) attempt(() => String(kept[k]([1])));
console.log(log.join("\n"));
