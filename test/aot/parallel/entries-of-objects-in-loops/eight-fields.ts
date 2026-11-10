const o = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
function main(n: number) { let s = 0; for (let i = 0; i < n; i++) s += Object.entries(o).map(e => e[0].length + e[1])[i & 7]!; console.log(s); }
main(300);
