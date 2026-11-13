// Short parts of wide strings appended to a growing string, and as keys of maps.
// COUNT: operationAOTMapSet <= 7000
let failures = 0;
const check = (name, found, expected) => { if (!Object.is(found, expected) && ++failures < 20) console.log(name, "is", found, "and not", expected); };
const words = []; let text = "";
for (let i = 0; i < 400; ++i) { const word = i % 7 === 6 ? "é" + i : i % 11 === 5 ? "名" + i : "w" + "x".repeat(i % 70) + i; words.push([text.length, text.length + word.length, word]); text += word + " "; }
text = JSON.parse(JSON.stringify(text + "—"));
const part = i => text.slice(words[i][0], words[i][1]);
const join = (from, to) => { let out = ""; for (let i = from; i < to; ++i) out += part(i); return out; };
const wrap = (from, to) => { let out = "("; for (let i = from; i < to; ++i) out += part(i) + "," + i + ";"; return out + ")"; };
const range = (from, to) => { let out = "["; for (let i = from; i < to; ++i) { out += text.substring(words[i][0], words[i][1]); out += "|"; } return out; };
const expectJoin = (from, to) => words.slice(from, to).map(word => word[2]).join("");
const expectWrap = (from, to) => "(" + words.slice(from, to).map((word, i) => word[2] + "," + (from + i) + ";").join("") + ")";
const expectRange = (from, to) => "[" + words.slice(from, to).map(word => word[2] + "|").join("");
for (let round = 0; round < 40; ++round) {
    for (const [from, to] of [[0, 1], [0, 2], [0, 5], [1, 4], [4, 6], [5, 6], [6, 7], [3, 30], [round, round + 60], [0, 400], [200, 203], [12, 13], [13, 14]]) {
        check("join", join(from, to), expectJoin(from, to));
        check("wrap", wrap(from, to), expectWrap(from, to));
        check("range", range(from, to), expectRange(from, to));
        check("length", join(from, to).length, expectJoin(from, to).length);
    }
}
let kept = "";
for (let i = 0; i < 400; ++i) { kept += part(i); if (i % 50 === 0) { check("read between", kept.length, expectJoin(0, i + 1).length); check("character", kept[kept.length - 1], words[i][2].at(-1)); } }
check("kept", kept, expectJoin(0, 400));
const object = {}; object[join(0, 3)] = 1; check("key", Object.keys(object)[0], expectJoin(0, 3)); check("by key", object[expectJoin(0, 3)], 1);
for (const [low, high] of [["ÿ", "Ā"], ["", ""], ["ab", "cd"], ["abÿ", "cdĀ"], ["abcÿ", "Ābcd"], ["abcdÿ", "abcdĀ"], ["abcdefgÿ", "abcĀefg"]]) {
    const wide = JSON.parse(JSON.stringify(low + high + "—")), a = wide.slice(0, low.length), b = wide.slice(low.length, low.length + high.length);
    let out = "("; for (let i = 0; i < 3; ++i) { out += a; out += b; } check("edges", out, "(" + (low + high).repeat(3));
    let other = ""; for (let i = 0; i < 30; ++i) { other += b; other += a; } check("other edges", other, (high + low).repeat(30));
}
const lone = JSON.parse(JSON.stringify("ab\ud83d—cd")); let halves = ""; for (let i = 0; i < 5; ++i) halves += lone.slice(1, 3) + lone.slice(4, 6); check("lone surrogate", halves, "b\ud83dcd".repeat(5));
// Maps and sets under parts of wide strings that they hold under equal keys.
const map = new Map(), set = new Set(), counts = new Map();
for (let round = 0; round < 60; ++round)
    for (let i = 0; i < 100; ++i) {
        const s = part(i); counts.set(s, (counts.get(s) || 0) + 1);
        map.set(part(i), round); set.add(part(i));
        check("value", map.get(words[i][2]), round); check("has", set.has(words[i][2]), true);
    }
check("sizes", map.size + set.size + counts.size, 300);
for (let i = 0; i < 100; ++i) { check("count", counts.get(words[i][2]), 60); check("key of map", [...map.keys()][i], words[i][2]); }
const s = part(3), t = part(6), u = part(5); map.set(s, 1); map.set(t, 2); map.set(u, 3); check("part after", s + t + u, words[3][2] + words[6][2] + words[5][2]); check("units", [s.charCodeAt(0), t.charCodeAt(0), u.charCodeAt(0)].join(), [words[3][2].charCodeAt(0), words[6][2].charCodeAt(0), words[5][2].charCodeAt(0)].join());
check("in a rope", ("—" + s + t).slice(1), words[3][2] + words[6][2]);
console.log("ended", failures);
