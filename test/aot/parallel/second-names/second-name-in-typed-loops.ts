// The same with written types: the fields have slots of their kinds, and the loops are built for small integers, fractions and texts.
type Sum = { n: number; text: string; flag: boolean; other: Sum | null };
function make(): Sum { return { n: 0, text: "", flag: false, other: null }; }
function integers(n: number) { const acc = make(); let k = acc; for (let i = 0; i < n; i++) { k.n = (k.n + i) | 0; k = k; } return acc.n; }
function fractions(n: number) { const acc = make(); let k = acc; for (let i = 0; i < n; i++) { k.n += 0.25; k = k; } return acc.n; }
function texts(n: number) { const acc = make(); let k = acc; for (let i = 0; i < n; i++) { k.text += i; k = k; } return acc.text; }
function flags(n: number) { const acc = make(); let k = acc; for (let i = 0; i < n; i++) { k.flag = !k.flag; k = k; } return acc.flag; }
function cells(n: number) { const acc = make(); let k = acc; for (let i = 0; i < n; i++) { k.other = k; k = k; } return acc.other === acc; }
function literal(n: number) { const acc: Sum = { n: 1, text: "t", flag: true, other: null }; let k: Sum = acc; for (let i = 0; i < n; i++) { k.n += i; k.text += "."; k.flag = false; k = k; } return acc.n + acc.text + acc.flag; }
class Counter { count = 0; readonly step: number; constructor(step: number) { this.step = step; } }
function instances(n: number) { const acc = new Counter(2); let k = acc; for (let i = 0; i < n; i++) { k.count += k.step; k = k; } return acc.count; }
function tuples(n: number) { const acc: [number, string] = [0, ""]; let k = acc; for (let i = 0; i < n; i++) { k[0] += i; k[1] += i; k = k; } return acc[0] + acc[1]; }
console.log(integers(0), integers(6), fractions(0), fractions(6), texts(0), texts(6), flags(0), flags(5), cells(0), cells(2), literal(0), literal(6), instances(0), instances(6), tuples(0), tuples(6));
let last = ""; for (let r = 0; r < 300; r++) last = [integers(6), fractions(6), texts(6), flags(5), cells(2), literal(6), instances(6), tuples(6)].join(" ");
console.log(last);
