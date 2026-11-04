function run(s: string): number { for (let i = 0; i < s.length; i++) { if (s.charCodeAt(i) === 32) return i; } return -1; }

const lengths = [0, 1, 7, 8, 9, 15, 16, 17, 25, 40];
function once(length: number, at: number): void { let text = ''; for (let i = 0; i < length; i++) text += i === at ? ' ' : 'abcdefg'[i % 7]; console.log(length, at, run(text)); }
for (let k = 0; k < lengths.length; k++) { for (let at = -1; at <= lengths[k]; at++) once(lengths[k], at); }
