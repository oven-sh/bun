function say(value: number): string { return Object.is(value, -0) ? '-0' : String(value); }
function run(s: string): number { let t = 0; for (let i = 0; i < s.length; i++) t += s.charCodeAt(i); return t; }
const lengths = [0, 1, 7, 8, 9, 15, 16, 17, 24, 25, 64, 100, 1000];
function once(length: number): void { let text = ''; let wide = ''; for (let i = 0; i < length; i++) { text += i % 7 ? 'a' : ' '; wide += i % 3 ? '\uffff' : 'b'; } console.log(length, say(run(text)), say(run(wide))); }
for (let k = 0; k < lengths.length; k++) once(lengths[k]);
