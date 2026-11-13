// Functions that call one another pass a number round and step it by one: at 2 ** 31, at 2 ** 53 and around both, down and up, over zero. The starts are written out, so that the build counts exactly.
function down(x: number, d: number): number { return d === 0 ? x : lower(x - 1, d - 1); }
function lower(x: number, d: number): number { return d === 0 ? x : down(x - 1, d - 1); }
function up(x: number, d: number): number { return d === 0 ? x : higher(x + 1, d - 1); }
function higher(x: number, d: number): number { return d === 0 ? x : up(1 + x, d - 1); }
function zigzag(x: number, d: number): number { return d === 0 ? x : d & 1 ? zag(x + 1, d - 1) : zag(x - 1, d - 1); }
function zag(x: number, d: number): number { return d === 0 ? x : zigzag(--x, d - 1); }
function sum(x: number, d: number): number { if (d === 0) return x & 1; const s = x - 1; return sum(s, d - 1) + (s % 7) + (s === -9007199254740992 ? 1 : 0); }
function even(x: number): boolean { return x === 0 ? true : odd(x - 1); }
function odd(x: number): boolean { return x === 0 ? false : even(x - 1); }
function anyDown(x: number, d: number): number { return d === 0 ? x : anyLower(x - 1, d - 1); }
function anyLower(x: number, d: number): number { return d === 0 ? x : anyDown(x - 1, d - 1); }
function text(x: number): string { return Object.is(x, -0) ? "-0" : String(x); }
for (let d = 0; d < 5; ++d) {
    console.log(d, text(down(0, d)), text(lower(0, d)), text(up(0, d)), text(higher(0, d)), text(zigzag(0, d)), text(zag(0, d)), text(sum(0, d)));
    console.log(d, text(down(1, d)), text(lower(1, d)), text(up(1, d)), text(higher(1, d)), text(zigzag(1, d)), text(zag(1, d)), text(sum(1, d)));
    console.log(d, text(down(5, d)), text(lower(5, d)), text(up(5, d)), text(higher(5, d)), text(zigzag(5, d)), text(zag(5, d)), text(sum(5, d)));
    console.log(d, text(down(-1, d)), text(lower(-1, d)), text(up(-1, d)), text(higher(-1, d)), text(zigzag(-1, d)), text(zag(-1, d)), text(sum(-1, d)));
    console.log(d, text(down(2147483646, d)), text(lower(2147483646, d)), text(up(2147483646, d)), text(higher(2147483646, d)), text(zigzag(2147483646, d)), text(zag(2147483646, d)), text(sum(2147483646, d)));
    console.log(d, text(down(2147483647, d)), text(lower(2147483647, d)), text(up(2147483647, d)), text(higher(2147483647, d)), text(zigzag(2147483647, d)), text(zag(2147483647, d)), text(sum(2147483647, d)));
    console.log(d, text(down(2147483648, d)), text(lower(2147483648, d)), text(up(2147483648, d)), text(higher(2147483648, d)), text(zigzag(2147483648, d)), text(zag(2147483648, d)), text(sum(2147483648, d)));
    console.log(d, text(down(-2147483647, d)), text(lower(-2147483647, d)), text(up(-2147483647, d)), text(higher(-2147483647, d)), text(zigzag(-2147483647, d)), text(zag(-2147483647, d)), text(sum(-2147483647, d)));
    console.log(d, text(down(-2147483648, d)), text(lower(-2147483648, d)), text(up(-2147483648, d)), text(higher(-2147483648, d)), text(zigzag(-2147483648, d)), text(zag(-2147483648, d)), text(sum(-2147483648, d)));
    console.log(d, text(down(9007199254740990, d)), text(lower(9007199254740990, d)), text(up(9007199254740990, d)), text(higher(9007199254740990, d)), text(zigzag(9007199254740990, d)), text(zag(9007199254740990, d)), text(sum(9007199254740990, d)));
    console.log(d, text(down(9007199254740991, d)), text(lower(9007199254740991, d)), text(up(9007199254740991, d)), text(higher(9007199254740991, d)), text(zigzag(9007199254740991, d)), text(zag(9007199254740991, d)), text(sum(9007199254740991, d)));
    console.log(d, text(down(9007199254740992, d)), text(lower(9007199254740992, d)), text(up(9007199254740992, d)), text(higher(9007199254740992, d)), text(zigzag(9007199254740992, d)), text(zag(9007199254740992, d)), text(sum(9007199254740992, d)));
    console.log(d, text(down(-9007199254740990, d)), text(lower(-9007199254740990, d)), text(up(-9007199254740990, d)), text(higher(-9007199254740990, d)), text(zigzag(-9007199254740990, d)), text(zag(-9007199254740990, d)), text(sum(-9007199254740990, d)));
    console.log(d, text(down(-9007199254740991, d)), text(lower(-9007199254740991, d)), text(up(-9007199254740991, d)), text(higher(-9007199254740991, d)), text(zigzag(-9007199254740991, d)), text(zag(-9007199254740991, d)), text(sum(-9007199254740991, d)));
    console.log(d, text(down(-9007199254740992, d)), text(lower(-9007199254740992, d)), text(up(-9007199254740992, d)), text(higher(-9007199254740992, d)), text(zigzag(-9007199254740992, d)), text(zag(-9007199254740992, d)), text(sum(-9007199254740992, d)));
}
console.log(even(1000), odd(1000), even(77), odd(77));
for (const start of [-0, 0.5, -0.5, NaN, Infinity, 2 ** 60, Number("7")])
    console.log(text(start), text(anyDown(start, 3)), text(anyLower(start, 4)));
