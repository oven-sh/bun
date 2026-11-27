// Texts held by properties and captured variables that grow by pieces of every width, and the beginnings and ends of parts.
let failures = 0;
const check = (name, found, expected) => { if (!Object.is(found, expected) && ++failures < 20) console.log(name, "is", found && found.length > 60 ? found.length + found.slice(-30) : found, "and not", expected && expected.length > 60 ? expected.length + expected.slice(-30) : expected); };
const wide = JSON.parse(JSON.stringify("prop: value; --custom: 名前 é —".repeat(40))), narrow = JSON.parse(JSON.stringify("prop: value; --custom: other é ".repeat(40)));
class Output { constructor(first) { this.text = first; this.length = 0; } add(piece) { this.text += piece; this.length += piece.length; } }
let captured = "";
const append = piece => { captured += piece; };
const pieces = [(i, s) => s.slice(i % 30, i % 30 + i % 9 + 1), (i, s) => s, (i, s) => "x", (i, s) => s.slice(0, 300), (i, s) => "w" + i, (i, s) => "名", (i, s) => s.substring(i % 50) + "y", (i, s) => "", (i, s) => s[i % 60], (i, s) => i, (i, s) => s.slice(2, 5) + s.slice(7, 12), (i, s) => "é".repeat(i % 5)];
for (const first of ["", "名", "narrow first", wide, narrow.repeat(20), "名".repeat(3000)])
    for (const s of [wide, narrow])
        for (let kind = 0; kind <= pieces.length; ++kind) {
            const output = new Output(first), expected = []; captured = first;
            for (let i = 0; i < 700; ++i) {
                const piece = "" + pieces[kind === pieces.length ? i % pieces.length : kind](i, s);
                output.add(piece); append(piece); if (kind !== 1 && kind !== 3 || i < 60) expected.push(piece); else { output.text = first + expected.join(""); captured = output.text; }
                if (i % 211 === 7) check("last unit", output.text.charCodeAt(output.text.length - 1), captured.charCodeAt(captured.length - 1));
                if (i === 300) { const kept = output.text, other = output.text + "other end"; output.text += "!"; expected.push("!"); append("!"); check("kept", kept + "!", output.text); check("other", other.slice(-9), "other end"); }
            }
            check("text", output.text, first + expected.join("")); check("captured", captured, first + expected.join(""));
        }
let branches = "名".repeat(2000); const both = [];
for (let i = 0; i < 200; ++i) { const a = branches + "a" + i, b = branches + "b" + i; if (i % 20 === 0) both.push(a, b); branches = i & 1 ? a : b; }
both.forEach((s, place) => { const i = Math.floor(place / 2) * 20; check("branch", s.slice(-1 - String(i).length), (place & 1 ? "b" : "a") + i); });
const starts = (s, other, at) => s.startsWith(other, at), ends = (s, other, at) => s.endsWith(other, at), has = (s, other) => s.includes(other);
for (let round = 0; round < 60; ++round)
    for (const s of [wide, narrow])
        for (let i = 0; i < 40; ++i) {
            const part = s.slice(i, i + 12), content = JSON.parse(JSON.stringify(part)), join = s.slice(i, i + 4) + s.slice(i + 4, i + 12);
            for (const other of ["--", "pro", part.slice(0, 3), part.slice(-4), "名", "", part, part + "x", s.slice(13, 15), "é", "値"]) {
                const name = i + " " + other, begins = content.slice(0, other.length) === other, finishes = other.length <= 12 && content.slice(12 - other.length) === other;
                check("starts " + name, starts(part, other), begins); check("ends " + name, ends(part, other), finishes);
                check("join starts " + name, starts(join, other), begins); check("starts at " + name, starts(part, other, 2), content.slice(2, 2 + other.length) === other && other.length <= 10);
                check("has " + name, has(part, other), content.indexOf(other) >= 0);
            }
        }
console.log("ended", failures);
