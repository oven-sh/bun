// A bit operator takes a sum of int32s for 0 where one of them is undefined: an element that a view lacks, a field that nothing was stored into.
// STATISTIC: SumsWithUndefinedTruncated >= 12
const bytes = new Uint8Array([3, 250, 7]);
const words = new Int32Array([2147483647, -2147483648, -1]);
class Link {
  next?: Link;
  count?: number;
  constructor(readonly weight: number) {}
}
const first = new Link(5);
const second = new Link(-2147483648);
second.count = 2147483647;
first.next = second;

function or(sum: number, at: number): number { return (sum | 0) + 0 === sum ? (sum + bytes[at]) | 0 : 0; }
function orOnTheLeft(sum: number, at: number): number { return (bytes[at] + (sum | 0)) | 0; }
function subtract(sum: number, at: number): number { return ((sum | 0) - bytes[at]) | 0; }
function subtractFrom(sum: number, at: number): number { return (bytes[at] - (sum | 0)) | 0; }
function and(sum: number, at: number): number { return ((sum | 0) + bytes[at]) & 255; }
function xor(sum: number, at: number): number { return 12345 ^ ((sum | 0) + bytes[at]); }
function not(sum: number, at: number): number { return ~((sum | 0) + bytes[at]); }
function unsigned(sum: number, at: number): number { return ((sum | 0) + bytes[at]) >>> 0; }
function shifted(sum: number, at: number): number { return ((sum | 0) + bytes[at]) << 3; }
function shiftedBy(sum: number, at: number): number { return 1 << ((sum | 0) + bytes[at]); }
function wraps(sum: number, at: number): number { return ((sum | 0) + words[at]) | 0; }
function wrapsBelow(sum: number, at: number): number { return ((sum | 0) - words[at]) | 0; }
function kept(sum: number, at: number): string { const whole = (sum | 0) + bytes[at]; return `${whole | 0} ${whole}`; }
function both(at: number, other: number): number { return (bytes[at] + bytes[other]) | 0; }
function nothing(sum: number): number { let x: any; return ((sum | 0) + x) | 0; }
function told(sum: number, at: number): number { const found = bytes[at]; if (found === undefined) return ((sum | 0) - found!) ^ 7; return ((sum | 0) - found) ^ 7; }
function chosen(sum: number, at: number): number { const found = at > 1 ? undefined : at; return ((sum | 0) + found!) | 0; }
function field(sum: number, link: Link): number { return ((sum | 0) + link.count!) | 0; }

const forms = [or, orOnTheLeft, subtract, subtractFrom, and, xor, not, unsigned, shifted, shiftedBy, wraps, wrapsBelow];
for (const form of forms) {
  const answers: number[] = [];
  for (const sum of [0, -1, 2147483647, -2147483648, 100]) {
    for (const at of [0, 1, 2, 3, -1, 1.5, NaN]) answers.push(form(sum, at));
  }
  console.log(form.name, answers.join());
}
for (const at of [0, 2, 3, -1]) console.log(kept(2147483647, at), both(at, 1), both(1, at), both(at, at));
for (const sum of [5, -1, 2147483647]) console.log(nothing(sum), told(sum, 0), told(sum, 9), chosen(sum, 0), chosen(sum, 1), chosen(sum, 2));
console.log(field(1, first), field(1, second), field(-5, first), field(2147483647, second));

function total(list: Uint8Array, steps: number): number {
  let sum = 0;
  let at = 0;
  for (let k = 0; k < steps; k++) sum = (sum + list[at++]) | 0;
  return sum;
}
function totalBelow(list: Int32Array, steps: number): number {
  let sum = 0;
  for (let k = steps; k-- > -2;) sum = (sum - list[k]) & 0x7fffffff;
  return sum;
}
for (const steps of [0, 1, 2, 3, 4, 5]) console.log(steps, total(bytes, steps), totalBelow(words, steps));
