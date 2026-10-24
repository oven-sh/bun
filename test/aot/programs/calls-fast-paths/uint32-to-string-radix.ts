// `(h >>> 0).toString(16)` on numbers whose top bit is set.
declare const console: any;
function hide<T>(x: T): T { return [x, x][console ? 0 : 1]!; }
function hex(h: number): string { return (h >>> 0).toString(16); }
function hexOfInt32(h: number): string { const i = h | 0; return (i >>> 0).toString(16); }
function decimal(h: number): string { return (h >>> 0).toString(); }
function binary(h: number): string { return (h >>> 0).toString(2).length + ""; }
function plus(h: number): string { return String((h >>> 0) + 1); }
function template(h: number): string { return `${h >>> 0}`; }
function hashed(text: string): string { let h = 7; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0; return h + " " + (h >>> 0).toString(16); }
for (const h of [0, 1, -1, -5, 2147483647, -2147483648, 2147483648, 4294967295, 305419896, -305419896]) console.log(h, hex(hide(h)), hexOfInt32(hide(h)), decimal(hide(h)), binary(hide(h)), plus(hide(h)), template(hide(h)));
console.log(hashed(hide("grab:18")), "|", hashed(hide("a longer text that wraps around many times")), "|", hashed(hide("zz")));
export {};
