function run(a: string, b: string): number { for (let i = 0; i < a.length; i++) { if (a.charCodeAt(i) !== b.charCodeAt(i)) return i; } return -1; }

const lengths = [0, 1, 7, 8, 9, 15, 16, 17, 25, 40];
function once(length: number, at: number): void { let text = ''; for (let i = 0; i < length; i++) text += i === at ? ' ' : 'abcdefg'[i % 7]; let other = ''; for (let i = 0; i < length; i++) other += 'abcdefg'[i % 7]; console.log(length, at, run(text, other), run(other, text)); }
for (let k = 0; k < lengths.length; k++) { for (let at = -1; at <= lengths[k]; at++) once(lengths[k], at); }
