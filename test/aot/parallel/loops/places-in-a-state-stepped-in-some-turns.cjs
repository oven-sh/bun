// Every turn reads the place that stands in an object's state, and some turns step it by one or by two: the loop carries it as a whole number, and what it meets there that is none is as written.
"use strict";
class Roll {
  constructor(text) { this.state = { place: 0, line: 1, depth: 0 }; this.text = text; this.end = text.length; }
  passSigns() {
    let pairs = 0, turns = 0;
    while (turns++ < 900) {
      const code = this.text.charCodeAt(this.state.place);
      if (code === 35) { this.state.line += 2; this.state.place++; }
      else if (code === 43) { if (this.text.charCodeAt(this.state.place + 1) !== 43) return -1; pairs++; this.state.place += 2; }
      else if (code === 46) this.state.place++;
      else break;
    }
    return this.state.place;
  }
  passMark(open, close) {
    let turns = 0;
    while (turns++ < 500) {
      const code = this.text.charCodeAt(this.state.place);
      if (code !== code) break;
      if (code === open) { this.state.depth++; this.state.place++; }
      else if (code === close) { this.state.place++; if (--this.state.depth === 0) break; }
      else if (code === 92) this.state.place += 2;
      else if (this.state.depth === 0) break;
      else this.state.place = this.state.place + 1;
    }
    return turns;
  }
}
const texts = ["..#.x", "++#++y", "", "none", "+", "++", "(a(b)c)d", "((\\)))tail", "(open", "\\(x", ".".repeat(300) + "(" + "z".repeat(40) + ")", "#".repeat(40) + "+a"];
for (const text of texts) { for (let k = 0; k < 4; k++) { const roll = new Roll(text), signs = roll.passSigns(); roll.passMark(40, 41); if (k === 3) console.log(JSON.stringify(text.slice(0, 12)), signs, JSON.stringify(roll.state)); } }
// Other values at the place: a fraction, a text, what is past 32 bits, nothing, not a number.
for (const place of [0.5, "1", 2 ** 31 - 2, 2 ** 31, -2, NaN, undefined, null, true, 1n, { valueOf: () => 2 }]) {
  const roll = new Roll("..#++..(a)."); roll.state.place = place;
  try { const at = roll.passSigns(); console.log(typeof at, String(at), roll.state.line); } catch (error) { console.log(error.constructor.name); }
  const other = new Roll("(a\\)b)"); other.state.place = place; other.state.depth = 1;
  try { console.log(other.passMark(40, 41), String(other.state.place), other.state.depth); } catch (error) { console.log(error.constructor.name); }
}
// The state is another object from a turn on, one with accessors, one that is frozen, one that a text's method changes.
let steps = [];
const watched = new Roll("...q"); watched.state = { line: 1, depth: 0, held: 0, get place() { steps.push("get"); return this.held; }, set place(v) { steps.push("set " + v); this.held = v; } }; console.log(watched.passSigns(), steps.join());
const frozen = new Roll(".x"); Object.freeze(frozen.state); try { frozen.passSigns(); } catch (error) { console.log(error.constructor.name, frozen.state.place); }
const swapped = new Roll("......x"); const first = swapped.state; let reads = 0;
swapped.text = { charCodeAt(at) { if (++reads === 3) swapped.state = { place: at + 1, line: 7, depth: 0 }; return reads < 6 ? 46 : 120; } }; console.log(swapped.passSigns(), first.place, swapped.state.line, reads);
const overflow = new Roll(""); overflow.state.place = 2 ** 31 - 4; overflow.text = { charCodeAt: at => (at < 2 ** 31 + 3 ? 46 : 0) }; console.log(overflow.passSigns(), overflow.state.place === 2 ** 31 + 3);
const below = Object.create(new Roll("..#.z")); console.log(below.passSigns(), Object.hasOwn(below, "state"), below.state.line);
