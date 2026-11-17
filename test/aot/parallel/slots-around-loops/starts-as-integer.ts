// A position that enters a loop as an integer comes round as one until some iteration stores something else: a fraction, -0, NaN, a number past 2 ** 53, undefined, or another name stores it.
// STATISTIC: SlotsCarriedAroundLoops >= 12
const bytes = new Uint8Array(16);
for (let i = 0; i < 16; i++) bytes[i] = i * 37;
const text = "abc def";
class Reader {
  at = 0;
  step = 1;
  next(): number { return bytes[this.at++]; }
}
class Wide extends Reader { more = 2; }
const other = new Reader();
function show(o: Reader, sum: number): string { return `${Object.is(o.at, -0) ? "-0" : o.at} ${Object.is(sum, -0) ? "-0" : sum}`; }
function forward(count: number): string { const o = new Reader(); let sum = 0; for (let k = 0; k < count; k++) sum = (sum + o.next()) | 0; return show(o, sum); }
function backward(count: number): string { const o = new Reader(); o.at = 9; let sum = 0; for (let k = 0; k < count; k++) sum = (sum + bytes[--o.at]) | 0; return show(o, sum); }
function halves(count: number): string { const o = new Reader(); let sum = 0; for (let k = 0; k < count; k++) { sum += bytes[o.at] === undefined ? 1 : 2; o.at += k === 3 ? 0.5 : 1; } return show(o, sum); }
function negated(count: number): string { const o = new Reader(); let sum = 0; for (let k = 0; k < count; k++) { sum += bytes[o.at] | 0; o.at = -o.at; sum += 1 / o.at > 0 ? 1 : 1000; } return show(o, sum); }
function notNumbers(count: number): string { const o = new Reader(); let sum = 0; for (let k = 0; k < count; k++) { sum += bytes[o.at] | 0; if (k === 2) o.at = NaN; else o.at++; } return show(o, sum); }
function large(count: number): string { const o = new Reader(); o.at = 9007199254740990; let sum = 0; for (let k = 0; k < count; k++) { sum += bytes[o.at] | 0; o.at++; } return show(o, sum); }
function larger(count: number): string { const o = new Reader(); let sum = 0; for (let k = 0; k < count; k++) { sum += bytes[o.at] | 0; o.at = (o.at + 1) * 1e6; } return show(o, sum); }
function steps(count: number, step: number): string { const o = new Reader(); o.step = step; let sum = 0; for (let k = 0; k < count; k++) { sum = (sum + bytes[o.at]) | 0; o.at += o.step; } return show(o, sum); }
function aliased(count: number, itself: boolean): string { const o = new Reader(), a = itself ? o : other; let sum = 0; for (let k = 0; k < count; k++) { sum = (sum + bytes[o.at++]) | 0; if (k === 2) a.at = 1.5; if (k === 4) a.at = 3; } return show(o, sum); }
function nested(count: number): string { const o = new Reader(); let sum = 0; for (let j = 0; j < 3; j++) { for (let k = 0; k < count; k++) { sum = (sum + bytes[o.at]) | 0; o.at++; } o.at = j === 1 ? 0.25 : 0; } return show(o, sum); }
function alternating(count: number): string { const o = new Wide(); let sum = 0; for (let k = 0; k < count; k++) { if (k & 1) o.at += 2; else o.at -= 1; sum = (sum ^ bytes[o.at & 15]) >>> 0; sum = (sum + bytes[o.at] + bytes[o.at + 2]) | 0; o.at -= k; } return show(o, sum); }
function letters(): string { const o = new Reader(); let sum = 0; while (o.at < text.length) { if (text[o.at] === " ") sum += 100; sum += text.charCodeAt(o.at++); } return show(o, sum); }
function writes(count: number): string { const o = new Reader(), to = new Uint8Array(8); for (let k = 0; k < count; k++) to[o.at++] = k * 3; return `${show(o, 0)} ${to.join()}`; }
function divided(count: number): string { const o = new Reader(); o.at = 12; let sum = 0; for (let k = 0; k < count; k++) { sum = (sum + (bytes[o.at] | 0)) | 0; o.at /= 2; } return show(o, sum); }
for (const count of [0, 1, 3, 5, 9, 20]) console.log(count, forward(count), backward(count), halves(count), negated(count), notNumbers(count), large(count), larger(count), nested(count), alternating(count), writes(count), divided(count));
console.log(steps(9, 1), steps(9, 2), steps(9, -1), steps(9, 0.5), steps(9, NaN), steps(3, 2 ** 53));
console.log(aliased(9, true), aliased(9, false), other.at, letters());
