// A field that every iteration of a loop reads and some iteration stores comes round the loop as a parameter: what another name stores, what does not fit an int32 and what a method stores is seen.
// STATISTIC: SlotsCarriedAroundLoops >= 14
const bytes = new Uint8Array(16);
for (let i = 0; i < 16; i++) bytes[i] = i * 37;
const list: number[] = [];
for (let i = 0; i < 16; i++) list.push(i * 3 - 7);
const text = "abc def 12 ghi, ";

class Reader {
  at = 0;
  steps = 0;
  next(): number { return bytes[this.at++]; }
  peek(): number { return list[this.at]; }
  skip(count: number): void { this.at += count; this.steps++; }
  word(): number { const start = this.at; while (this.at < text.length && text.charCodeAt(this.at) > 32) this.at++; return this.at - start; }
  all(count: number): number { let sum = 0; for (let k = 0; k < count; k++) { sum = (sum + this.next()) | 0; this.skip(k & 1); } return sum; }
}
class Wide extends Reader { more = 1; }
const kept = [new Reader(), new Wide()];

function counted(o: Reader, count: number): number { let sum = 0; for (let k = 0; k < count; k++) { sum = (sum + bytes[o.at]) | 0; o.at++; } return sum; }
function listed(o: Reader, count: number): number { let sum = 0; let k = 0; while (k++ < count) sum = (sum + (list[o.at++] | 0)) | 0; return sum; }
function bounded(o: Reader, limit: number): number { let sum = 0; while (o.at < limit) { sum = (sum + o.next()) | 0; } return sum; }
function below(o: Reader, count: number): number { let sum = 0; for (let k = 0; k < count; k++) sum = (sum + bytes[--o.at]) | 0; return sum; }
function aliased(o: Reader, other: Reader, count: number): number { let sum = 0; for (let k = 0; k < count; k++) { sum = (sum + bytes[o.at++]) | 0; if (k === 3) other.at = 1; } return sum; }
function chosen(o: Reader, other: Reader, count: number): number { let sum = 0; for (let k = 0; k < count; k++) { const taken = k & 1 ? o : other; taken.at += 2; sum = (sum + bytes[o.at]) | 0; } return sum; }
function copied(o: Reader, other: Reader, count: number): number { let sum = 0; for (let k = 0; k < count; k++) { other.at = o.at + 1; sum += o.at; o.steps = k; } return sum; }
function nested(o: Reader, count: number): number { let sum = 0; for (let j = 0; j < 3; j++) { o.at = j; for (let k = 0; k < count; k++) sum = (sum + bytes[o.at++]) | 0; sum += o.at; } return sum; }
function left(o: Reader, count: number): number { let sum = 0; for (let k = 0; k < count; k++) { o.at++; if (o.at === 5) break; if (k & 1) continue; sum += o.at; } return sum; }
function fraction(o: Reader, count: number): number { let sum = 0; for (let k = 0; k < count; k++) { sum += list[o.at] === undefined ? 1 : 2; o.at += k === 4 ? 0.5 : 1; } return sum; }
function negated(o: Reader, count: number): number { let sum = 0; for (let k = 0; k < count; k++) { o.at = -o.at; sum += 1 / o.at; } return sum; }
function thrown(o: Reader, count: number): number { let sum = 0; for (let k = 0; k < count; k++) { try { o.at++; if (k === 2) throw k; sum += o.at; } catch { sum += 100 * o.at; } } return sum; }
function words(o: Reader): string { const found: number[] = []; while (o.at < text.length) { found.push(o.word()); o.at++; } return found.join(); }
function counter(o: Reader, count: number): number { for (let k = 0; k < count; k++) { o.steps++; if (k & 2) o.steps += 3; } return o.steps; }

function show(x: number | string): string { return Object.is(x, -0) ? "-0" : String(x); }
function call(name: string, o: Reader): number | string {
  switch (name) {
    case "counted": { return counted(o, 12); }
    case "listed": { return listed(o, 12); }
    case "bounded": { return o.at > -1e9 && o.at < 1e3 ? bounded(o, 20) : -1; }
    case "below": { return below(o, 5); }
    case "aliased to itself": { return aliased(o, o, 9); }
    case "aliased to another": { kept[0].at = 4; return aliased(o, kept[0], 9); }
    case "chosen": { return chosen(o, kept[0], 9); }
    case "chosen of itself": { return chosen(o, o, 9); }
    case "copied": { return copied(o, kept[1], 7); }
    case "nested": { return nested(o, 6); }
    case "left": { return left(o, 9); }
    case "fraction": { return fraction(o, 9); }
    case "negated": { return negated(o, 5); }
    case "thrown": { return thrown(o, 5); }
    case "words": { return o.at >= 0 && o.at < 20 ? words(o) : "none"; }
    case "counter": { return counter(o, 9); }
    case "all": { return o.all(9); }
    case "peek": { let sum = 0; for (let k = 0; k < 5; k++) { sum += o.peek() ?? 50; o.skip(1); } return sum; }
  }
  return "none";
}
function once(name: string, o: Reader, start: number): string {
  o.at = start; o.steps = 0;
  return `${show(call(name, o))}:${show(o.at)}:${o.steps}`;
}
for (const name of ["counted", "listed", "bounded", "below", "aliased to itself", "aliased to another", "chosen", "chosen of itself", "copied", "nested", "left", "fraction", "negated", "thrown", "words", "counter", "all", "peek"]) {
  for (let k = 0; k < 2; k++) {
    const o = kept[k];
    console.log(name, once(name, o, 0), once(name, o, 3), once(name, o, -2), once(name, o, 2147483640), once(name, o, 2147483647), once(name, o, -2147483648), once(name, o, 9007199254740991), once(name, o, 0.5), once(name, o, -0), once(name, o, NaN));
  }
}

// Objects that nothing else names.
function fresh(count: number): string { const o = new Reader(); let sum = 0; for (let k = 0; k < count; k++) sum = (sum + o.next()) | 0; return `${sum} ${o.at}`; }
function pair(count: number): string { const a = new Reader(), b = new Reader(); for (let k = 0; k < count; k++) { a.at++; if (a.at > 3) b.at += a.at; } return `${a.at} ${b.at}`; }
console.log(fresh(0), fresh(9), fresh(20), pair(0), pair(9));
