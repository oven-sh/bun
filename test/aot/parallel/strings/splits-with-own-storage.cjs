// A list that a split makes and that the same function stores into has storage of its own from the start; what the engine keeps of the split is not changed.
// STATISTIC: StringsSplitWithOwnStorage >= 3
const log = [];
const id = v => [v][0];
function shout(text, by) { const parts = text.split(by); for (let i = 0; i < parts.length; i++) parts[i] = parts[i] + "!"; return parts.join("|") + parts.length; }
function grow(text, by) { const parts = text.split(by); parts[parts.length] = "end"; parts.push(1.5); parts[0] = null; return JSON.stringify(parts); }
function limited(text, by, limit) { const parts = text.split(by, limit); parts[1] = { by }; return JSON.stringify(parts) + parts.length; }
function kept(text, by) { let first; try { first = text.split(by); } catch (e) { return e.message; } const second = text.split(by); first[0] = "changed"; return first[0] + second[0] + text.split(by)[0]; }
function literal() { const parts = "a,b,c".split(","); parts[1] = 7; return parts.join() + "a,b,c".split(",").join(); }
const texts = ["a,b,c", "", "abc", "l, F d, Y g:i:s A", "жб,日本", id("a") + id(",b"), id("xx,a,byy").slice(2, 6), "k".repeat(30), new String("a,b"), 12, null, undefined, { split: () => ["own"] }, { split: (by) => Object.freeze(["frozen", by]) }];
const separators = [",", "", "b", ", ", id(",") + id(""), /,/, undefined, null, 1, { [Symbol.split]: (text, limit) => ["symbol", text, limit] }];
const attempt = f => { try { log.push(f()); } catch (e) { log.push(e.name + ": " + e.message); } };
for (let turn = 0; turn < 2; turn++)
    for (const text of texts) for (const by of separators) {
        attempt(() => shout(text, by));
        attempt(() => grow(text, by));
        attempt(() => limited(text, by, [undefined, 0, 1, 2, -1][log.length % 5]));
        attempt(() => kept(text, by));
        attempt(literal);
    }
console.log(log.join("\n"));
