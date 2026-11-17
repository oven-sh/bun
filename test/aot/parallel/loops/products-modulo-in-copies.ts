// Functions that are copied into a loop and return a remainder: the sign of zero is seen there, or it is not.
function plain(l: number[]): number { let p = 1; for (let i = 0; i < l.length; i++) p = (p * (l[i]! + 1)) % 10007; return p; }
function inverted(l: number[]): number { let p = -1; for (let i = 0; i < l.length; i++) p = (p * l[i]!) % 1009; return p; }
function fromZero(l: number[]): number { let p = -1; for (let i = 0; i < l.length; i++) p = (p * l[i]!) % 1009; return p; }
function added(l: number[]): number { let p = -1; for (let i = 0; i < l.length; i++) p = (p * l[i]!) % 1009; return p; }
function summed(l: number[]): number { let s = -3; for (let i = 0; i < l.length; i++) s = (s + l[i]!) % 3; return s; }
function kept(l: number[]): number { let p = -1; for (let i = 0; i < l.length; i++) p = (p * l[i]!) % 11; return p; }
function past(l: number[]): number { let p = 1; for (let i = 0; i <= l.length; i++) p = (p * 3 + l[i]!) % 1009; return p; }
function masked(l: number[]): number { let p = 1; for (let i = 0; i < 12; i++) p = (p * 3 + l[(i * 7) & 15]!) % 1009; return p; }
const twice: number[] = Array.from({ length: 40 }, (_, i) => i * 7 % 101);
const pushed: number[] = []; for (let i = 0; i < 40; i++) pushed.push(i * 7 % 101 - 50);
const zeros: number[] = []; for (let i = 0; i < 2; i++) zeros.push(i ? 0 : 3);
const threes: number[] = []; for (let i = 0; i < 4; i++) threes.push(i - 3);
let n = 0; for (let k = 0; k < 4000; k++) n += plain(twice); console.log(n);
let a = 0; for (let k = 0; k < 4000; k++) a += 1 / inverted(zeros); console.log(a);
let b = -0; for (let k = 0; k < 4000; k++) b += fromZero(zeros); console.log(1 / b);
let c = 0; for (let k = 0; k < 4000; k++) c += added(zeros); console.log(1 / c, c);
let d = 0; for (let k = 0; k < 4000; k++) if (Object.is(summed(threes), -0)) d++; console.log(d);
const out: number[] = []; for (let k = 0; k < 4000; k++) out.push(kept(zeros)); console.log(1 / out[7]!, out.length);
let e = 0; for (let k = 0; k < 4000; k++) e += past(pushed); console.log(e);
let g = 0; for (let k = 0; k < 4000; k++) g += masked(zeros); console.log(g);
