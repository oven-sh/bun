// Loops over lines whose side paths run other code: the iteration runs once in the generic version. Three scanners, one behind the other.
{
class State { constructor() { this.pos = 0; this.line = 1; this.sum = 0; this.hits = 0; this.last = -1; this.flag = false; } }
function isWord(code) { if (code < 48) return code === 36; if (code < 58) return true; if (code < 65) return false; if (code < 91) return true; if (code < 97) return code === 95; if (code < 123) return true; return code >= 0xaa && wide.test(String.fromCharCode(code)); }
const wide = new RegExp("[" + "\xaa-\xff" + "]");
class Scanner { constructor(input, list) { this.state = new State(); this.input = input; this.list = list; }
 at() { const code = this.input.charCodeAt(this.state.pos); if (code <= 0xd7ff || code >= 0xe000) return code; return (code << 10) + this.input.charCodeAt(this.state.pos + 1) - 0x35fdc00; }
 run() { let w = "", first = true, start = this.state.pos, total = 0; loop: while (this.state.pos < this.input.length) { const ch = this.input.charCodeAt(this.state.pos); switch (ch) { case 32: case 97: ++this.state.pos; break; case 92: this.state.flag = true; globalThis.note(this, w); ++this.state.pos; break; case 98: this.state.line++; this.state.pos += 1; break; default: break loop; } first = false; } return w + this.input.slice(start, this.state.pos) + "|" + first + total; } }
let calls = 0; globalThis.note = function (s, w) { calls++; s.state["x" + calls] = calls; return calls; }; globalThis.kept = [State, Scanner];
const inputs = ["abc", "ab\\cd\\ef gh", "\\\\a\\", "aaaa\\aaaaaaaa\\bbbbbbbb\\ b\\a", "a\u00e9\\\u{1f600}b\\", "", "a a b\\a b a\\a", "\u{1f600}\u{1f600}a"];
const lists = [[1, 2, 92, 3, 92], [92, 92, 92], [1.5, 92, 2.5, 92, 92, 92], [], [1, "2", 92, null, 92], [1, 92, , 3, 92]];
function drive(round) { for (let k = 0; k < inputs.length; k++) {
  calls = round; const s = new Scanner(inputs[k], lists[k % lists.length].slice()); let r; try { r = s.run(); } catch (e) { r = e.constructor.name + ":" + e.message.slice(0, 30); }
  console.log(0, r, calls, JSON.stringify(s.state), s.list.length, String(s.input).length); delete State.prototype.sum; } }
for (let round = 0; round < 3; round++) drive(round);
}
{
class State { constructor() { this.pos = 0; this.line = 1; this.sum = 0; this.hits = 0; this.last = -1; this.flag = false; } }
function isWord(code) { if (code < 48) return code === 36; if (code < 58) return true; if (code < 65) return false; if (code < 91) return true; if (code < 97) return code === 95; if (code < 123) return true; return code >= 0xaa && wide.test(String.fromCharCode(code)); }
const wide = new RegExp("[" + "\xaa-\xff" + "]");
class Scanner { constructor(input, list) { this.state = new State(); this.input = input; this.list = list; }
 at() { const code = this.input.charCodeAt(this.state.pos); if (code <= 0xd7ff || code >= 0xe000) return code; return (code << 10) + this.input.charCodeAt(this.state.pos + 1) - 0x35fdc00; }
 run() { let w = "", first = true, start = this.state.pos, total = 0; loop: while (this.state.pos < this.input.length) { const ch = this.input.charCodeAt(this.state.pos); switch (ch) { case 32: case 97: ++this.state.pos; break; case 92: if (globalThis.note(this, w) > 3) throw new Error("n" + this.state.pos); ++this.state.pos; break; case 98: this.state.line++; this.state.pos += 1; break; default: break loop; } first = false; } return w + this.input.slice(start, this.state.pos) + "|" + first + total; } }
let calls = 0; globalThis.note = function (s, w) { calls++; s.state["x" + calls] = calls; return calls; }; globalThis.kept = [State, Scanner];
const inputs = ["abc", "ab\\cd\\ef gh", "\\\\a\\", "aaaa\\aaaaaaaa\\bbbbbbbb\\ b\\a", "a\u00e9\\\u{1f600}b\\", "", "a a b\\a b a\\a", "\u{1f600}\u{1f600}a"];
const lists = [[1, 2, 92, 3, 92], [92, 92, 92], [1.5, 92, 2.5, 92, 92, 92], [], [1, "2", 92, null, 92], [1, 92, , 3, 92]];
function drive(round) { for (let k = 0; k < inputs.length; k++) {
  calls = round; const s = new Scanner(inputs[k], lists[k % lists.length].slice()); let r; try { r = s.run(); } catch (e) { r = e.constructor.name + ":" + e.message.slice(0, 30); }
  console.log(1, r, calls, JSON.stringify(s.state), s.list.length, String(s.input).length); delete State.prototype.sum; } }
for (let round = 0; round < 3; round++) drive(round);
}
{
class State { constructor() { this.pos = 0; this.line = 1; this.sum = 0; this.hits = 0; this.last = -1; this.flag = false; } }
function isWord(code) { if (code < 48) return code === 36; if (code < 58) return true; if (code < 65) return false; if (code < 91) return true; if (code < 97) return code === 95; if (code < 123) return true; return code >= 0xaa && wide.test(String.fromCharCode(code)); }
const wide = new RegExp("[" + "\xaa-\xff" + "]");
class Scanner { constructor(input, list) { this.state = new State(); this.input = input; this.list = list; }
 at() { const code = this.input.charCodeAt(this.state.pos); if (code <= 0xd7ff || code >= 0xe000) return code; return (code << 10) + this.input.charCodeAt(this.state.pos + 1) - 0x35fdc00; }
 run() { let w = "", first = true, start = this.state.pos, total = 0; loop: while (this.state.pos < this.input.length) { const ch = this.input.charCodeAt(this.state.pos); switch (ch) { case 32: case 97: ++this.state.pos; break; case 92: if (globalThis.note(this, w) & 1) { this.state.pos++; if (this.state.pos > 60) return "far"; continue; } ++this.state.pos; break; case 98: this.state.line++; this.state.pos += 1; break; default: break loop; } first = false; } return w + this.input.slice(start, this.state.pos) + "|" + first + total; } }
let calls = 0; globalThis.note = function (s, w) { calls++; if (calls === 2) s.input = new String(s.input); return calls; }; globalThis.kept = [State, Scanner];
const inputs = ["abc", "ab\\cd\\ef gh", "\\\\a\\", "aaaa\\aaaaaaaa\\bbbbbbbb\\ b\\a", "a\u00e9\\\u{1f600}b\\", "", "a a b\\a b a\\a", "\u{1f600}\u{1f600}a"];
const lists = [[1, 2, 92, 3, 92], [92, 92, 92], [1.5, 92, 2.5, 92, 92, 92], [], [1, "2", 92, null, 92], [1, 92, , 3, 92]];
function drive(round) { for (let k = 0; k < inputs.length; k++) {
  calls = round; const s = new Scanner(inputs[k], lists[k % lists.length].slice()); let r; try { r = s.run(); } catch (e) { r = e.constructor.name + ":" + e.message.slice(0, 30); }
  console.log(2, r, calls, JSON.stringify(s.state), s.list.length, String(s.input).length); delete State.prototype.sum; } }
for (let round = 0; round < 3; round++) drive(round);
}
