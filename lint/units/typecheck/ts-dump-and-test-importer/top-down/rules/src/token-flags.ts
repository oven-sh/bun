const a = 'single';
const b = "double";
const c = 'esc\x41\u0042\u{43}';
const d = 1e3 + 0x10 + 0b1 + 0o7 + 1_000 + 10n + 0xffn;
const e = `plain`;
const f = `head${a}mid\x41${b}tail\u0042`;
const g = /re/g;
const h = String.raw`\uworld ${a} \xtra`;
