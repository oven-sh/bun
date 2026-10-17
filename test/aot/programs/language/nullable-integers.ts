// Integers beside `undefined` and `null`: in bit operations, as conditions, compared with each other, with constants and with nil.
declare const console: { log(...values: unknown[]): void };
class Links { checkFlags?: number; depth?: number; wide?: number; mark: number | null = null; both?: number | null; }
function flagsOf(l: Links): number { return ((l.checkFlags as number) & 6) + ((l.checkFlags as number) | 1) * 10 + ((l.checkFlags as number) ^ 3) * 100 + (~(l.checkFlags as number)) * 1000 + ((l.checkFlags as number) << 2) + ((l.checkFlags as number) >> 1) + ((l.checkFlags as number) >>> 28); }
function has(l: Links, mask: number): boolean { return ((l.checkFlags as number) & mask) !== 0; }
function orZero(l: Links): number { return (l.wide as number) | 0; }
function markBits(l: Links): number { return ((l.mark as number) & 255) + ((l.both as number) | 0); }
function truthy(l: Links): string { return (l.checkFlags ? "f" : "-") + (l.depth ? "d" : "-") + (l.wide ? "w" : "-") + (l.mark ? "m" : "-") + (l.both ? "b" : "-") + (!l.checkFlags ? "F" : "-") + (!l.wide ? "W" : "-"); }
function nil(l: Links): string { return [l.checkFlags === undefined, l.checkFlags == null, l.mark === null, l.mark == undefined, l.both === undefined, l.both === null, l.both == null, l.wide !== undefined].map(v => v ? "y" : "n").join(""); }
function same(a: Links, b: Links): string { return [a.checkFlags === b.checkFlags, a.depth === b.checkFlags, a.mark === b.mark, a.both === b.both, a.both == b.both, a.wide === b.wide, a.checkFlags === 0, a.checkFlags === 4, a.wide === 4294967296, a.depth !== b.depth].map(v => v ? "y" : "n").join(""); }
function orElse(l: Links): number { return (l.checkFlags ?? -1) + (l.depth || 7) * 10 + (l.mark ?? -2) * 100 + (l.both ?? -3) * 1000; }
function counted(all: Links[]): number { let n = 0; for (const l of all) { if (l.checkFlags) n++; if (l.wide) n += 10; if ((l.checkFlags as number) & 4) n += 100; } return n; }
function make(flags: number | undefined, depth: number | undefined, wide: number | undefined, mark: number | null, both: number | null | undefined): Links { const l = new Links(); if (flags !== undefined) l.checkFlags = flags | 0; if (depth !== undefined) l.depth = depth | 0; if (wide !== undefined) l.wide = Math.trunc(wide); l.mark = mark === null ? null : mark | 0; if (both !== undefined) l.both = both === null ? null : both | 0; return l; }
const all = [
    make(undefined, undefined, undefined, null, undefined), make(0, 0, 0, 0, 0), make(4, 1, 1, 1, 1), make(-1, -1, -1, -1, -1), make(6, 2, 4294967296, 256, null), make(2147483647, 3, 8589934592, 255, 65536),
    make(-2147483648, 4, -4294967296, -256, -65536), make(1, undefined, 4294967297, null, null), make(undefined, 5, 9007199254740991, 7, undefined), make(65536, 6, -9007199254740991, 1 << 30, 1 << 31), make(7, 0, 281474976710656, 0, 0),
];
for (const l of all) console.log(flagsOf(l), has(l, 4), has(l, 1 << 31), orZero(l), markBits(l), truthy(l), nil(l), orElse(l));
console.log(all.map(a => all.map(b => same(a, b)).join(" ")).join("\n"));
console.log(counted(all));
