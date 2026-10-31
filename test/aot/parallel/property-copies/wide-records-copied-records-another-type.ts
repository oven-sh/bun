// Records with many optional members, most of which lie outside the cell, are copied into records of another type, with every subset of members a kind of its own.
interface Source { m00?: number; m01?: string; m02?: boolean; m03?: number | string; m04?: { v: number }; m05?: number[]; m06?: number; m07?: string; m08?: boolean; m09?: number | string; m10?: { v: number }; m11?: number[]; m12?: number; m13?: string; m14?: boolean; m15?: number | string; m16?: { v: number }; m17?: number[]; m18?: number; m19?: string; m20?: boolean; m21?: number | string; m22?: { v: number }; m23?: number[]; m24?: number; m25?: string; m26?: boolean; m27?: number | string; m28?: { v: number }; m29?: number[]; m30?: number; m31?: string; m32?: boolean; m33?: number | string; m34?: { v: number }; m35?: number[]; m36?: number; m37?: string; m38?: boolean; m39?: number | string; m40?: { v: number }; m41?: number[]; m42?: number; m43?: string; m44?: boolean; m45?: number | string; m46?: { v: number }; m47?: number[]; m48?: number; m49?: string; m50?: boolean; m51?: number | string; m52?: { v: number }; m53?: number[]; m54?: number; m55?: string; m56?: boolean; m57?: number | string; m58?: { v: number }; m59?: number[]; m60?: number; m61?: string; m62?: boolean; m63?: number | string; m64?: { v: number }; m65?: number[]; m66?: number; m67?: string; m68?: boolean; m69?: number | string; m70?: { v: number }; m71?: number[]; }
interface Target extends Source { tag: number; x00?: string; x01?: string; x02?: string; x03?: string; x04?: string; x05?: string; x06?: string; x07?: string; x08?: string; x09?: string; x10?: string; x11?: string; }
function make(i: number, low: number, high: number, top: number): Source {
  const made: Source = {};
  if (low & 1) made.m00 = i + 0;
  if (low & 2) made.m01 = "s1" + i;
  if (low & 4) made.m02 = (i & 1) === 2 % 2;
  if (low & 8) made.m03 = i & 2 ? "t3" : i + 3.5;
  if (low & 16) made.m04 = { v: i + 4 };
  if (low & 32) made.m05 = [i, 5];
  if (low & 64) made.m06 = i + 6;
  if (low & 128) made.m07 = "s7" + i;
  if (low & 256) made.m08 = (i & 1) === 8 % 2;
  if (low & 512) made.m09 = i & 2 ? "t9" : i + 9.5;
  if (low & 1024) made.m10 = { v: i + 10 };
  if (low & 2048) made.m11 = [i, 11];
  if (low & 4096) made.m12 = i + 12;
  if (low & 8192) made.m13 = "s13" + i;
  if (low & 16384) made.m14 = (i & 1) === 14 % 2;
  if (low & 32768) made.m15 = i & 2 ? "t15" : i + 15.5;
  if (low & 65536) made.m16 = { v: i + 16 };
  if (low & 131072) made.m17 = [i, 17];
  if (low & 262144) made.m18 = i + 18;
  if (low & 524288) made.m19 = "s19" + i;
  if (low & 1048576) made.m20 = (i & 1) === 20 % 2;
  if (low & 2097152) made.m21 = i & 2 ? "t21" : i + 21.5;
  if (low & 4194304) made.m22 = { v: i + 22 };
  if (low & 8388608) made.m23 = [i, 23];
  if (high & 1) made.m24 = i + 24;
  if (high & 2) made.m25 = "s25" + i;
  if (high & 4) made.m26 = (i & 1) === 26 % 2;
  if (high & 8) made.m27 = i & 2 ? "t27" : i + 27.5;
  if (high & 16) made.m28 = { v: i + 28 };
  if (high & 32) made.m29 = [i, 29];
  if (high & 64) made.m30 = i + 30;
  if (high & 128) made.m31 = "s31" + i;
  if (high & 256) made.m32 = (i & 1) === 32 % 2;
  if (high & 512) made.m33 = i & 2 ? "t33" : i + 33.5;
  if (high & 1024) made.m34 = { v: i + 34 };
  if (high & 2048) made.m35 = [i, 35];
  if (high & 4096) made.m36 = i + 36;
  if (high & 8192) made.m37 = "s37" + i;
  if (high & 16384) made.m38 = (i & 1) === 38 % 2;
  if (high & 32768) made.m39 = i & 2 ? "t39" : i + 39.5;
  if (high & 65536) made.m40 = { v: i + 40 };
  if (high & 131072) made.m41 = [i, 41];
  if (high & 262144) made.m42 = i + 42;
  if (high & 524288) made.m43 = "s43" + i;
  if (high & 1048576) made.m44 = (i & 1) === 44 % 2;
  if (high & 2097152) made.m45 = i & 2 ? "t45" : i + 45.5;
  if (high & 4194304) made.m46 = { v: i + 46 };
  if (high & 8388608) made.m47 = [i, 47];
  if (top & 1) made.m48 = i + 48;
  if (top & 2) made.m49 = "s49" + i;
  if (top & 4) made.m50 = (i & 1) === 50 % 2;
  if (top & 8) made.m51 = i & 2 ? "t51" : i + 51.5;
  if (top & 16) made.m52 = { v: i + 52 };
  if (top & 32) made.m53 = [i, 53];
  if (top & 64) made.m54 = i + 54;
  if (top & 128) made.m55 = "s55" + i;
  if (top & 256) made.m56 = (i & 1) === 56 % 2;
  if (top & 512) made.m57 = i & 2 ? "t57" : i + 57.5;
  if (top & 1024) made.m58 = { v: i + 58 };
  if (top & 2048) made.m59 = [i, 59];
  if (top & 4096) made.m60 = i + 60;
  if (top & 8192) made.m61 = "s61" + i;
  if (top & 16384) made.m62 = (i & 1) === 62 % 2;
  if (top & 32768) made.m63 = i & 2 ? "t63" : i + 63.5;
  if (top & 65536) made.m64 = { v: i + 64 };
  if (top & 131072) made.m65 = [i, 65];
  if (top & 262144) made.m66 = i + 66;
  if (top & 524288) made.m67 = "s67" + i;
  if (top & 1048576) made.m68 = (i & 1) === 68 % 2;
  if (top & 2097152) made.m69 = i & 2 ? "t69" : i + 69.5;
  if (top & 4194304) made.m70 = { v: i + 70 };
  if (top & 8388608) made.m71 = [i, 71];
  return made;
}
function copy(source: Source, tag: number): Target { return { tag, ...source }; }
function copyUnder(source: Source, tag: number): Target { return { ...source, tag, x03: "x" }; }
function rest(source: Source): Source { const { m00, m25, m50, ...others } = source; return others; }
const lines: string[] = [];
let seed = 99;
function next(): number { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed & 0xffffff; }
const words: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0xffffff, 0xffffff, 0xffffff], [0x555555, 0xaaaaaa, 0x555555]];
for (let i = 0; i < 40; i++) words.push([next() & next(), next() & next(), next() & next() & next()]);
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < words.length; i++) {
    const [low, high, top] = words[i];
    const source = make(i, low, high, top);
    for (const made of [copy(source, i), copyUnder(source, i), rest(source), copy(rest(source), i)])
      lines.push(round + " " + i + ": " + Object.keys(made).join("") + " " + JSON.stringify(made));
  }
}
if (typeof Bun !== "undefined") Bun.gc(true);
let hash = 0;
for (const line of lines) for (let i = 0; i < line.length; i++) hash = (Math.imul(hash, 31) + line.charCodeAt(i)) | 0;
console.log(lines.length, hash);
console.log(lines.slice(0, 12).join("\n"));
console.log(lines.slice(-4).join("\n"));
