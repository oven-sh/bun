'use strict';
// Readers whose loops run other code on side ways, in turns inside of turns: that code exchanges, freezes and changes what the loops hold.
let calls = 0, at = -1;
let act = () => {};
const side = reader => { if (++calls === at) act(reader); return calls & 1; };
class Reader {
  constructor(text) { this.text = text; this.place = 0; this.marks = []; this.row = 0; this.on = { seen: 0 }; }
  words() {
    let n = 0;
    while (this.place < this.text.length) {
      let c = this.text.charCodeAt(this.place);
      if (c === 32) { this.place++; continue; }
      const from = this.place;
      while (this.place < this.text.length) {
        c = this.text.charCodeAt(this.place);
        if (c === 35) { side(this); }
        if (c === 32) break;
        this.place++;
      }
      this.marks.push(from);
      this.on.seen += this.place - from;
      n++;
    }
    return n;
  }
  rows(list) {
    let sum = 0;
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      for (let j = 0; j < row.length; j++) {
        if (row[j] < 0) sum += side(this) + list.length;
        sum += row[j] * this.row;
      }
      this.row++;
    }
    return sum;
  }
}
const acts = {
  nothing() {},
  text(r) { r.text = 'an other # text with # marks'; },
  wide(r) { r.text += '€ # more'; },
  number(r) { r.text = 12345; },
  place(r) { r.place += 3; },
  fraction(r) { r.place += .5; },
  back(r) { r.place = Math.max(0, r.place - 1); at = -1; },
  word(r) { r.place = '9'; at = -1; },
  frozen(r) { Object.freeze(r); },
  fixed(r) { Object.defineProperty(r, 'place', { writable: false }); },
  getter(r) { const on = { get seen() { return 5; }, set seen(x) { calls += 10; } }; r.on = on; },
  marks(r) { r.marks = Object.freeze([]); },
  row(r) { r.row = 2.5; },
  gone(r) { delete r.row; },
  proto(r) { Object.setPrototypeOf(r, { words() { return -1; } }); },
};
const text = 'one two# three #four five#six  #  seven# eight';
const grid = () => [[1, 2, -3], [4, -5, 6], [-7, 8], [], [.5, -1.5], [9, -9, 9]];
for (const name of Object.keys(acts)) for (const when of [1, 2, 4, 5]) {
  calls = 0; at = when; act = acts[name];
  const said = [];
  for (const f of [() => { const r = new Reader(text); const n = r.words(); return n + ':' + r.place + ':' + r.marks.join() + ':' + r.on.seen; }, () => { calls = 0; const r = new Reader(text), g = grid(); const s = r.rows(g); return s + ':' + r.row; }, () => { calls = 0; const g = grid(), r = new Reader(text); act = x => { g.length = 4; acts[name](x); }; return r.rows(g) + ':' + r.row; }, () => { calls = 0; const g = grid(), r = new Reader(text); act = x => { g[when] = ['a', -1]; acts[name](x); }; return r.rows(g) + ':' + r.row; }]) {
    let r;
    try { r = f(); } catch (e) { r = e.constructor.name; }
    said.push(String(r).length > 90 ? String(r).slice(0, 90) : r);
    if (calls > 2000) break;
  }
  console.log(name, when, said.join(' '), calls);
}
