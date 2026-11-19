function tag(strings, ...values) { return { strings, values }; }
function run(i) { const o = { v: i }; return tag`a${o}b${[i]}c`; }
function match(text) { const m = /(\d+)-(?<w>\w+)/.exec(text); return [m, m.groups]; }
const t = run(1), [m, groups] = match("12-ab");
console.log(t.strings.raw.join("|"), t.values[0].v, t.values[1][0], run(2).strings === t.strings, m[1], groups.w);
