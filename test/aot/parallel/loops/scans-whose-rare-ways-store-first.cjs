// Scans whose rare ways store and then run other code, inside other loops: the code puts another list, another text or another counter in place, freezes, shortens, and throws.
const held = JSON.parse("{}"), name = text => text + process.argv.length % 1;
class Scan {
  constructor(text, list, told) { this.text = text; this.list = list; this.at = 0; this.lines = 0; this.told = told; this.last = -1; }
  words() {
    let count = 0;
    for (let turn = 0; turn < 3; turn++) {
      this.at = turn;
      while (this.at < this.text.length) {
        const code = this.text.charCodeAt(this.at);
        if (code === 10) { this.lines++; this.last = this.at; this.told(this, count); }
        else if (code === 32) count += this.list[this.at % this.list.length];
        this.at++;
      }
    }
    return count;
  }
  marks(rows) {
    let sum = 0;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const value = row[c];
        if (value < 0) { row[c] = -value; this.last = r * 10 + c; this.told(this, sum); }
        sum += value * (this.lines + 1);
      }
    }
    return sum;
  }
}
const texts = ["one two\nthree four", "a b\n\nc d e", "", "\n", "line\nline\nline line", "αβ γ\nδ ε"];
const changes = {
  none() {}, moves(scan) { scan.at += 2; }, back(scan) { if (scan.lines < 9) scan.at -= 1, scan.lines += 2; }, text(scan) { if (scan.lines === 2) scan.text = "x y\nz w v u"; }, shorter(scan) { scan.text = scan.text.slice(0, 5); }, list(scan) { scan.list = [0.5, 100]; }, words(scan) { scan.list = ["p", "q"]; }, frozen(scan) { if (scan.lines === 3) Object.freeze(scan.list); },
  empty(scan) { scan.list.length = 0; }, throws(scan, count) { if (scan.lines > 2) throw new RangeError("at " + count); }, rope(scan) { scan.text = scan.text + "\n" + scan.lines; if (scan.lines > 12) scan.text = ""; }, double(scan) { scan.at += 0.5; }, string(scan) { scan.lines = String(scan.lines); }, replaced(scan) { if (scan.lines === 2) scan.told = changes.moves; },
  accessor(scan) { if (scan.lines === 1) { let at = scan.at; Object.defineProperty(scan, "at", { get() { return at; }, set(value) { at = value + 1; }, configurable: true }); } }, gone(scan) { delete scan.last; }, big(scan) { scan.at = 2 ** 31 + scan.at; },
};
const rowSets = { plain: () => [[1, -2, 3], [-4, 5], []], doubles: () => [[0.5, -1.5], [2, -0]], text: () => [[1, "-2"], ["x", -3]], frozen: () => [Object.freeze([1, -2]), [3]], views: () => [Int8Array.of(1, -2, 3), Float32Array.of(-1.5)], holes: () => [[1, , -3], [-1]], shared: () => { const row = [-1, 2, -3]; return [row, row]; }, longer: () => Array.from({ length: 9 }, (_, r) => Array.from({ length: 5 }, (_, c) => (r * c) % 7 - 3)) };
const lines = [], say = value => Object.is(value, -0) ? "-0" : String(value);
for (let round = 0; round < 3; round++) for (const kind of Object.keys(changes)) {
  for (const text of texts) { const scan = new Scan(text, [1, 2, 3], changes[kind]); let answer; try { answer = say(scan.words()); } catch (error) { answer = error.constructor.name; } lines.push([round, kind, answer, scan.lines, scan.last, scan.at, scan.list.length].join(" ")); }
  for (const set of Object.keys(rowSets)) { const rows = rowSets[set](), scan = new Scan("", [1], changes[kind]); let answer; try { answer = say(scan.marks(rows)); } catch (error) { answer = error.constructor.name; } lines.push([kind, set, answer, scan.lines, scan.last, rows.map(row => Array.from(row, say).join()).join("|")].join(" ")); }
}
console.log(lines.join("\n"));
