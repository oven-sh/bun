// One variable takes references read out of fields on most paths and on one path an object that lies in a frame, the caller's or the function's own. A block that never runs keeps a function from being inlined.
class Point {
  v: number; w: number; x: number; y: number;
  constructor(v: number) { this.v = v | 0; this.w = 1; this.x = 2; this.y = 3; }
}
class Holder {
  n: number;
  a: Point | undefined; b: Point | undefined; c: Point | undefined; d: Point | undefined; e: Point | undefined; f: Point | undefined; g: Point | undefined;
  constructor(base: number) {
    this.n = base | 0;
    this.a = new Point(base + 1); this.b = new Point(base + 2); this.c = base & 256 ? undefined : new Point(base + 3); this.d = new Point(base + 4);
    this.e = new Point(base + 5); this.f = new Point(base + 6); this.g = new Point(base + 7);
  }
}
const holders: Holder[] = [];
for (let i = 0; i < 8; ++i) holders.push(new Holder(i * 100));
let never = process.argv.length | 0;
let g1 = 1, g2 = 2, g3 = 3, g4 = 4, g5 = 5, g6 = 6, g7 = 7, g8 = 8, g9 = 9, g10 = 10, g11 = 11, g12 = 12, g13 = 13;

function borrowed(h: Holder, own: Point, k: number): number {
  if (never > 1000000) {
    g1 = ((g4 + 3) ^ g8) | 0; g2 = ((g5 + 5) ^ g9) | 0; g3 = ((g6 + 7) ^ g10) | 0; g4 = ((g7 + 9) ^ g11) | 0; g5 = ((g8 + 11) ^ g12) | 0; g6 = ((g9 + 13) ^ g13) | 0;
    g7 = ((g10 + 15) ^ g1) | 0; g8 = ((g11 + 17) ^ g2) | 0; g9 = ((g12 + 19) ^ g3) | 0; g10 = ((g13 + 21) ^ g4) | 0; g11 = ((g1 + 23) ^ g5) | 0; g12 = ((g2 + 25) ^ g6) | 0;
    g13 = ((g3 + 27) ^ g7) | 0; g1 = ((g4 + 29) ^ g8) | 0; g2 = ((g5 + 31) ^ g9) | 0; g3 = ((g6 + 33) ^ g10) | 0; g4 = ((g7 + 35) ^ g11) | 0; g5 = ((g8 + 37) ^ g12) | 0;
    g6 = ((g9 + 39) ^ g13) | 0; g7 = ((g10 + 41) ^ g1) | 0; g8 = ((g11 + 43) ^ g2) | 0; g9 = ((g12 + 45) ^ g3) | 0; g10 = ((g13 + 47) ^ g4) | 0; g11 = ((g1 + 49) ^ g5) | 0;
    g12 = ((g2 + 51) ^ g6) | 0; g13 = ((g3 + 53) ^ g7) | 0; g1 = ((g4 + 55) ^ g8) | 0; g2 = ((g5 + 57) ^ g9) | 0; g3 = ((g6 + 59) ^ g10) | 0; g4 = ((g7 + 61) ^ g11) | 0;
    g5 = ((g8 + 63) ^ g12) | 0; g6 = ((g9 + 65) ^ g13) | 0; g7 = ((g10 + 67) ^ g1) | 0; g8 = ((g11 + 69) ^ g2) | 0; g9 = ((g12 + 71) ^ g3) | 0; g10 = ((g13 + 73) ^ g4) | 0;
    g11 = ((g1 + 75) ^ g5) | 0; g12 = ((g2 + 77) ^ g6) | 0; g13 = ((g3 + 79) ^ g7) | 0; g1 = ((g4 + 81) ^ g8) | 0; g2 = ((g5 + 83) ^ g9) | 0; g3 = ((g6 + 85) ^ g10) | 0;
    g4 = ((g7 + 87) ^ g11) | 0; g5 = ((g8 + 89) ^ g12) | 0; g6 = ((g9 + 91) ^ g13) | 0; g7 = ((g10 + 93) ^ g1) | 0; g8 = ((g11 + 95) ^ g2) | 0; g9 = ((g12 + 97) ^ g3) | 0;
    g10 = ((g13 + 99) ^ g4) | 0; g11 = ((g1 + 101) ^ g5) | 0; g12 = ((g2 + 103) ^ g6) | 0; g13 = ((g3 + 105) ^ g7) | 0; g1 = ((g4 + 107) ^ g8) | 0; g2 = ((g5 + 109) ^ g9) | 0;
    g3 = ((g6 + 111) ^ g10) | 0; g4 = ((g7 + 113) ^ g11) | 0; g5 = ((g8 + 115) ^ g12) | 0; g6 = ((g9 + 117) ^ g13) | 0; g7 = ((g10 + 119) ^ g1) | 0; g8 = ((g11 + 121) ^ g2) | 0;
  }
  let x: Point | undefined;
  switch (k) {
    case 0: x = h.a; break;
    case 1: x = h.b; break;
    case 2: x = h.c; break;
    case 3: x = h.d; break;
    case 4: x = h.e; break;
    case 5: x = h.f; break;
    case 6: x = h.g; break;
    default: x = own;
  }
  return x === undefined ? -1 : x.v;
}
function made(h: Holder, k: number, n: number): number {
  if (never > 1000000) {
    g1 = ((g4 + 3) ^ g8) | 0; g2 = ((g5 + 5) ^ g9) | 0; g3 = ((g6 + 7) ^ g10) | 0; g4 = ((g7 + 9) ^ g11) | 0; g5 = ((g8 + 11) ^ g12) | 0; g6 = ((g9 + 13) ^ g13) | 0;
    g7 = ((g10 + 15) ^ g1) | 0; g8 = ((g11 + 17) ^ g2) | 0; g9 = ((g12 + 19) ^ g3) | 0; g10 = ((g13 + 21) ^ g4) | 0; g11 = ((g1 + 23) ^ g5) | 0; g12 = ((g2 + 25) ^ g6) | 0;
    g13 = ((g3 + 27) ^ g7) | 0; g1 = ((g4 + 29) ^ g8) | 0; g2 = ((g5 + 31) ^ g9) | 0; g3 = ((g6 + 33) ^ g10) | 0; g4 = ((g7 + 35) ^ g11) | 0; g5 = ((g8 + 37) ^ g12) | 0;
    g6 = ((g9 + 39) ^ g13) | 0; g7 = ((g10 + 41) ^ g1) | 0; g8 = ((g11 + 43) ^ g2) | 0; g9 = ((g12 + 45) ^ g3) | 0; g10 = ((g13 + 47) ^ g4) | 0; g11 = ((g1 + 49) ^ g5) | 0;
    g12 = ((g2 + 51) ^ g6) | 0; g13 = ((g3 + 53) ^ g7) | 0; g1 = ((g4 + 55) ^ g8) | 0; g2 = ((g5 + 57) ^ g9) | 0; g3 = ((g6 + 59) ^ g10) | 0; g4 = ((g7 + 61) ^ g11) | 0;
    g5 = ((g8 + 63) ^ g12) | 0; g6 = ((g9 + 65) ^ g13) | 0; g7 = ((g10 + 67) ^ g1) | 0; g8 = ((g11 + 69) ^ g2) | 0; g9 = ((g12 + 71) ^ g3) | 0; g10 = ((g13 + 73) ^ g4) | 0;
    g11 = ((g1 + 75) ^ g5) | 0; g12 = ((g2 + 77) ^ g6) | 0; g13 = ((g3 + 79) ^ g7) | 0; g1 = ((g4 + 81) ^ g8) | 0; g2 = ((g5 + 83) ^ g9) | 0; g3 = ((g6 + 85) ^ g10) | 0;
    g4 = ((g7 + 87) ^ g11) | 0; g5 = ((g8 + 89) ^ g12) | 0; g6 = ((g9 + 91) ^ g13) | 0; g7 = ((g10 + 93) ^ g1) | 0; g8 = ((g11 + 95) ^ g2) | 0; g9 = ((g12 + 97) ^ g3) | 0;
    g10 = ((g13 + 99) ^ g4) | 0; g11 = ((g1 + 101) ^ g5) | 0; g12 = ((g2 + 103) ^ g6) | 0; g13 = ((g3 + 105) ^ g7) | 0; g1 = ((g4 + 107) ^ g8) | 0; g2 = ((g5 + 109) ^ g9) | 0;
    g3 = ((g6 + 111) ^ g10) | 0; g4 = ((g7 + 113) ^ g11) | 0; g5 = ((g8 + 115) ^ g12) | 0; g6 = ((g9 + 117) ^ g13) | 0; g7 = ((g10 + 119) ^ g1) | 0; g8 = ((g11 + 121) ^ g2) | 0;
  }
  const own = new Point(n);
  let x: Point | undefined;
  switch (k) {
    case 0: x = h.a; break;
    case 1: x = h.b; break;
    case 2: x = h.c; break;
    case 3: x = h.d; break;
    case 4: x = h.e; break;
    case 5: x = h.f; break;
    case 6: x = h.g; break;
    default: x = own;
  }
  return x === undefined ? -1 : x.v;
}
function chosen(h: Holder, own: Point, k: number): number {
  if (never > 1000000) {
    g1 = ((g4 + 3) ^ g8) | 0; g2 = ((g5 + 5) ^ g9) | 0; g3 = ((g6 + 7) ^ g10) | 0; g4 = ((g7 + 9) ^ g11) | 0; g5 = ((g8 + 11) ^ g12) | 0; g6 = ((g9 + 13) ^ g13) | 0;
    g7 = ((g10 + 15) ^ g1) | 0; g8 = ((g11 + 17) ^ g2) | 0; g9 = ((g12 + 19) ^ g3) | 0; g10 = ((g13 + 21) ^ g4) | 0; g11 = ((g1 + 23) ^ g5) | 0; g12 = ((g2 + 25) ^ g6) | 0;
    g13 = ((g3 + 27) ^ g7) | 0; g1 = ((g4 + 29) ^ g8) | 0; g2 = ((g5 + 31) ^ g9) | 0; g3 = ((g6 + 33) ^ g10) | 0; g4 = ((g7 + 35) ^ g11) | 0; g5 = ((g8 + 37) ^ g12) | 0;
    g6 = ((g9 + 39) ^ g13) | 0; g7 = ((g10 + 41) ^ g1) | 0; g8 = ((g11 + 43) ^ g2) | 0; g9 = ((g12 + 45) ^ g3) | 0; g10 = ((g13 + 47) ^ g4) | 0; g11 = ((g1 + 49) ^ g5) | 0;
    g12 = ((g2 + 51) ^ g6) | 0; g13 = ((g3 + 53) ^ g7) | 0; g1 = ((g4 + 55) ^ g8) | 0; g2 = ((g5 + 57) ^ g9) | 0; g3 = ((g6 + 59) ^ g10) | 0; g4 = ((g7 + 61) ^ g11) | 0;
    g5 = ((g8 + 63) ^ g12) | 0; g6 = ((g9 + 65) ^ g13) | 0; g7 = ((g10 + 67) ^ g1) | 0; g8 = ((g11 + 69) ^ g2) | 0; g9 = ((g12 + 71) ^ g3) | 0; g10 = ((g13 + 73) ^ g4) | 0;
    g11 = ((g1 + 75) ^ g5) | 0; g12 = ((g2 + 77) ^ g6) | 0; g13 = ((g3 + 79) ^ g7) | 0; g1 = ((g4 + 81) ^ g8) | 0; g2 = ((g5 + 83) ^ g9) | 0; g3 = ((g6 + 85) ^ g10) | 0;
    g4 = ((g7 + 87) ^ g11) | 0; g5 = ((g8 + 89) ^ g12) | 0; g6 = ((g9 + 91) ^ g13) | 0; g7 = ((g10 + 93) ^ g1) | 0; g8 = ((g11 + 95) ^ g2) | 0; g9 = ((g12 + 97) ^ g3) | 0;
    g10 = ((g13 + 99) ^ g4) | 0; g11 = ((g1 + 101) ^ g5) | 0; g12 = ((g2 + 103) ^ g6) | 0; g13 = ((g3 + 105) ^ g7) | 0; g1 = ((g4 + 107) ^ g8) | 0; g2 = ((g5 + 109) ^ g9) | 0;
    g3 = ((g6 + 111) ^ g10) | 0; g4 = ((g7 + 113) ^ g11) | 0; g5 = ((g8 + 115) ^ g12) | 0; g6 = ((g9 + 117) ^ g13) | 0; g7 = ((g10 + 119) ^ g1) | 0; g8 = ((g11 + 121) ^ g2) | 0;
  }
  const x = k === 0 ? h.a : k === 1 ? h.b : k === 2 ? h.c : k === 3 ? h.d : own;
  return x === undefined ? -1 : x.v;
}
function small(h: Holder, own: Point, k: number): number {
  let x: Point | undefined;
  switch (k) {
    case 0: x = h.a; break;
    case 1: x = h.b; break;
    case 2: x = h.c; break;
    case 3: x = h.d; break;
    case 4: x = h.e; break;
    case 5: x = h.f; break;
    case 6: x = h.g; break;
    default: x = own;
  }
  return x === undefined ? -1 : x.v;
}

const sums = [0, 0, 0, 0];
for (let i = 0; i < 256; ++i) {
  const h = holders[(i >> 3) & 7];
  sums[0] = (sums[0] + borrowed(h, new Point(40 + i), i & 7)) | 0;
  sums[1] = (sums[1] + made(h, i & 7, 40 + i)) | 0;
  sums[2] = (sums[2] + chosen(h, new Point(40 + i), i & 7)) | 0;
  sums[3] = (sums[3] + small(h, new Point(40 + i), i & 7)) | 0;
}
console.log(sums.join(" "), g1 + g13);
