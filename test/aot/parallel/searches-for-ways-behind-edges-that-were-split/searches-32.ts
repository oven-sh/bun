class Box { v = 0; }
const sink = new Box();
function make(n: number): Box { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; const b = new Box(); b.v = (n + w) | 0; return b; }
function side(n: number): number { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return (Math.imul(n, 3) + w) | 0; }
function run(c: number, k: number): number {
  let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0;
  const m0 = (k + 901) | 0, m1 = (k + 902) | 0, m2 = (k + 903) | 0, m3 = (k + 904) | 0, m4 = (k + 905) | 0, m5 = (k + 906) | 0;
  const keep1 = make(k), keep2 = make(k + 1);
  let x: Box | null = (c & 1) !== 0 ? keep1 : make(k + 2);
  let t = (x.v + w) | 0;
  x = null;
  t = (t + side(t)) | 0;
  if ((c & 2) !== 0) sink.v = (sink.v + keep1.v) | 0;
  const a0 = (k + 1) | 0, b0 = (k + 2) | 0; if ((c & 4) !== 0) sink.v = (side(0) + b0 + a0) | 0; t = (t ^ a0 ^ b0) | 0;
  const a1 = (k + 3) | 0, b1 = (k + 4) | 0; if ((c & 8) !== 0) sink.v = (side(1) + b1 + a1) | 0; t = (t ^ a1 ^ b1) | 0;
  const a2 = (k + 5) | 0, b2 = (k + 6) | 0; if ((c & 16) !== 0) sink.v = (side(2) + b2 + a2) | 0; t = (t ^ a2 ^ b2) | 0;
  const a3 = (k + 7) | 0, b3 = (k + 8) | 0; if ((c & 32) !== 0) sink.v = (side(3) + b3 + a3) | 0; t = (t ^ a3 ^ b3) | 0;
  const a4 = (k + 9) | 0, b4 = (k + 10) | 0; if ((c & 64) !== 0) sink.v = (side(4) + b4 + a4) | 0; t = (t ^ a4 ^ b4) | 0;
  const a5 = (k + 11) | 0, b5 = (k + 12) | 0; if ((c & 128) !== 0) sink.v = (side(5) + b5 + a5) | 0; t = (t ^ a5 ^ b5) | 0;
  const a6 = (k + 13) | 0, b6 = (k + 14) | 0; if ((c & 256) !== 0) sink.v = (side(6) + b6 + a6) | 0; t = (t ^ a6 ^ b6) | 0;
  const a7 = (k + 15) | 0, b7 = (k + 16) | 0; if ((c & 512) !== 0) sink.v = (side(7) + b7 + a7) | 0; t = (t ^ a7 ^ b7) | 0;
  const a8 = (k + 17) | 0, b8 = (k + 18) | 0; if ((c & 1024) !== 0) sink.v = (side(8) + b8 + a8) | 0; t = (t ^ a8 ^ b8) | 0;
  const a9 = (k + 19) | 0, b9 = (k + 20) | 0; if ((c & 2048) !== 0) sink.v = (side(9) + b9 + a9) | 0; t = (t ^ a9 ^ b9) | 0;
  const a10 = (k + 21) | 0, b10 = (k + 22) | 0; if ((c & 4096) !== 0) sink.v = (side(10) + b10 + a10) | 0; t = (t ^ a10 ^ b10) | 0;
  const a11 = (k + 23) | 0, b11 = (k + 24) | 0; if ((c & 8192) !== 0) sink.v = (side(11) + b11 + a11) | 0; t = (t ^ a11 ^ b11) | 0;
  const a12 = (k + 25) | 0, b12 = (k + 26) | 0; if ((c & 4) !== 0) sink.v = (side(12) + b12 + a12) | 0; t = (t ^ a12 ^ b12) | 0;
  const a13 = (k + 27) | 0, b13 = (k + 28) | 0; if ((c & 8) !== 0) sink.v = (side(13) + b13 + a13) | 0; t = (t ^ a13 ^ b13) | 0;
  const a14 = (k + 29) | 0, b14 = (k + 30) | 0; if ((c & 16) !== 0) sink.v = (side(14) + b14 + a14) | 0; t = (t ^ a14 ^ b14) | 0;
  const a15 = (k + 31) | 0, b15 = (k + 32) | 0; if ((c & 32) !== 0) sink.v = (side(15) + b15 + a15) | 0; t = (t ^ a15 ^ b15) | 0;
  const a16 = (k + 33) | 0, b16 = (k + 34) | 0; if ((c & 64) !== 0) sink.v = (side(16) + b16 + a16) | 0; t = (t ^ a16 ^ b16) | 0;
  const a17 = (k + 35) | 0, b17 = (k + 36) | 0; if ((c & 128) !== 0) sink.v = (side(17) + b17 + a17) | 0; t = (t ^ a17 ^ b17) | 0;
  const a18 = (k + 37) | 0, b18 = (k + 38) | 0; if ((c & 256) !== 0) sink.v = (side(18) + b18 + a18) | 0; t = (t ^ a18 ^ b18) | 0;
  const a19 = (k + 39) | 0, b19 = (k + 40) | 0; if ((c & 512) !== 0) sink.v = (side(19) + b19 + a19) | 0; t = (t ^ a19 ^ b19) | 0;
  const a20 = (k + 41) | 0, b20 = (k + 42) | 0; if ((c & 1024) !== 0) sink.v = (side(20) + b20 + a20) | 0; t = (t ^ a20 ^ b20) | 0;
  const a21 = (k + 43) | 0, b21 = (k + 44) | 0; if ((c & 2048) !== 0) sink.v = (side(21) + b21 + a21) | 0; t = (t ^ a21 ^ b21) | 0;
  const a22 = (k + 45) | 0, b22 = (k + 46) | 0; if ((c & 4096) !== 0) sink.v = (side(22) + b22 + a22) | 0; t = (t ^ a22 ^ b22) | 0;
  const a23 = (k + 47) | 0, b23 = (k + 48) | 0; if ((c & 8192) !== 0) sink.v = (side(23) + b23 + a23) | 0; t = (t ^ a23 ^ b23) | 0;
  const a24 = (k + 49) | 0, b24 = (k + 50) | 0; if ((c & 4) !== 0) sink.v = (side(24) + b24 + a24) | 0; t = (t ^ a24 ^ b24) | 0;
  const a25 = (k + 51) | 0, b25 = (k + 52) | 0; if ((c & 8) !== 0) sink.v = (side(25) + b25 + a25) | 0; t = (t ^ a25 ^ b25) | 0;
  const a26 = (k + 53) | 0, b26 = (k + 54) | 0; if ((c & 16) !== 0) sink.v = (side(26) + b26 + a26) | 0; t = (t ^ a26 ^ b26) | 0;
  const a27 = (k + 55) | 0, b27 = (k + 56) | 0; if ((c & 32) !== 0) sink.v = (side(27) + b27 + a27) | 0; t = (t ^ a27 ^ b27) | 0;
  const a28 = (k + 57) | 0, b28 = (k + 58) | 0; if ((c & 64) !== 0) sink.v = (side(28) + b28 + a28) | 0; t = (t ^ a28 ^ b28) | 0;
  const a29 = (k + 59) | 0, b29 = (k + 60) | 0; if ((c & 128) !== 0) sink.v = (side(29) + b29 + a29) | 0; t = (t ^ a29 ^ b29) | 0;
  const a30 = (k + 61) | 0, b30 = (k + 62) | 0; if ((c & 256) !== 0) sink.v = (side(30) + b30 + a30) | 0; t = (t ^ a30 ^ b30) | 0;
  const a31 = (k + 63) | 0, b31 = (k + 64) | 0; if ((c & 512) !== 0) sink.v = (side(31) + b31 + a31) | 0; t = (t ^ a31 ^ b31) | 0;
  let y: Box | null = (c & 1) === 0 ? keep2 : make(k + 3);
  t = (t + y.v) | 0;
  y = null;
  if ((c & 2) !== 0) sink.v = (sink.v + keep2.v) | 0;
  return (t + m0 + m1 + m2 + m3 + m4 + m5 + sink.v) | 0;
}
let h = 0;
for (let c = 0; c < 70000; c = (c + 977) | 0) h = (Math.imul(h, 31) + run(c, c & 255)) | 0;
console.log(h);
