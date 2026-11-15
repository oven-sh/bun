"use strict";
// A loop reckons with a name read off rows of several kinds. Halfway code out of a text deletes the name on one prototype, makes it a getter on another and lays it on one row.
const turns = Number(process.argv[2] ?? 24000), hide = value => [value][JSON.parse("0")];
function total(rows) { let sum = 0; for (const row of rows) sum += (row.pad ?? 100) * 2; return sum; }
const ask = hide(total), said = [];
const fill = make => { const rows = JSON.parse("[0,0,0,0,0,0,0,0]"); for (let at = 0; at < rows.length; at++) rows[at] = hide(make(at)); return rows; };
function P(at) { this.kind = at; } function Q(at) { this.sort = at; this.more = 3; } function R(at) { this.x = at; this.y = 2; } function S(at) { this.x = at; this.y = 2; this.z = 3; }
P.prototype.pad = 3; Q.prototype.pad = 4; R.prototype.pad = 5; S.prototype.pad = 6;
const early = [fill(at => new P(at)), fill(at => new Q(at)), fill(at => new R(at))], late = fill(at => new S(at)), every = [...early, late];
let all = 0;
for (const rows of early) for (let call = 0; call < 4000; call++) all += ask(rows);
for (let turn = 0; turn < turns; turn++) {
    if (turn === turns >> 1) { new Function("S", "R", "late", "delete S.prototype.pad; Object.defineProperty(R.prototype, 'pad', { get() { return 9; }, configurable: true }); late[3].pad = 7;")(S, R, late); }
    const got = ask(every[turn & 3]); all += got;
    if (turn % 1999 === 0) said.push(turn + ":" + got);
}
console.log(all, said.join(" "));
