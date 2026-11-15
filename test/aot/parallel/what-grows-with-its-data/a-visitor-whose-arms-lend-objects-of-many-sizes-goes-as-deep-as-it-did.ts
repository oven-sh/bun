// A visitor calls itself once for each level; each of its eight arms hands a small test an object that it has just made, of 4, 8 .. 32 fields. Only one arm runs at a level, and each object is done with
// when its call has returned: the frame of the visitor has room for the largest of them, not for all eight.
// Sizes: 500 2000 8000
// Passes: 20
// Grows: linear
const size = Number(process.env.SIZE ?? 1000);
const passes = Number(process.env.PASSES ?? 2);

function lies(bag: any, value: number): boolean {
  let at = bag.f00;
  for (let turn = 0; turn < 2 && at < value; turn++) at += 1;
  return value >= bag.f00 && value <= bag.f03 && at >= bag.f00;
}

function visit(depth: number, kind: number): number {
  if (depth === 0) return 0;
  let found = 0;
  switch (kind) {
    case 0: if (lies({ f00: depth + 0, f01: depth + 1, f02: depth + 2, f03: depth + 3 }, depth)) found++; break;
    case 1: if (lies({ f00: depth + 0, f01: depth + 1, f02: depth + 2, f03: depth + 3, f04: depth + 4, f05: depth + 5, f06: depth + 6, f07: depth + 7 }, depth)) found++; break;
    case 2: if (lies({ f00: depth + 0, f01: depth + 1, f02: depth + 2, f03: depth + 3, f04: depth + 4, f05: depth + 5, f06: depth + 6, f07: depth + 7, f08: depth + 8, f09: depth + 9, f10: depth + 10, f11: depth + 11 }, depth)) found++; break;
    case 3: if (lies({ f00: depth + 0, f01: depth + 1, f02: depth + 2, f03: depth + 3, f04: depth + 4, f05: depth + 5, f06: depth + 6, f07: depth + 7, f08: depth + 8, f09: depth + 9, f10: depth + 10, f11: depth + 11, f12: depth + 12, f13: depth + 13, f14: depth + 14, f15: depth + 15 }, depth)) found++; break;
    case 4: if (lies({ f00: depth + 0, f01: depth + 1, f02: depth + 2, f03: depth + 3, f04: depth + 4, f05: depth + 5, f06: depth + 6, f07: depth + 7, f08: depth + 8, f09: depth + 9, f10: depth + 10, f11: depth + 11, f12: depth + 12, f13: depth + 13, f14: depth + 14, f15: depth + 15, f16: depth + 16, f17: depth + 17, f18: depth + 18, f19: depth + 19 }, depth)) found++; break;
    case 5: if (lies({ f00: depth + 0, f01: depth + 1, f02: depth + 2, f03: depth + 3, f04: depth + 4, f05: depth + 5, f06: depth + 6, f07: depth + 7, f08: depth + 8, f09: depth + 9, f10: depth + 10, f11: depth + 11, f12: depth + 12, f13: depth + 13, f14: depth + 14, f15: depth + 15, f16: depth + 16, f17: depth + 17, f18: depth + 18, f19: depth + 19, f20: depth + 20, f21: depth + 21, f22: depth + 22, f23: depth + 23 }, depth)) found++; break;
    case 6: if (lies({ f00: depth + 0, f01: depth + 1, f02: depth + 2, f03: depth + 3, f04: depth + 4, f05: depth + 5, f06: depth + 6, f07: depth + 7, f08: depth + 8, f09: depth + 9, f10: depth + 10, f11: depth + 11, f12: depth + 12, f13: depth + 13, f14: depth + 14, f15: depth + 15, f16: depth + 16, f17: depth + 17, f18: depth + 18, f19: depth + 19, f20: depth + 20, f21: depth + 21, f22: depth + 22, f23: depth + 23, f24: depth + 24, f25: depth + 25, f26: depth + 26, f27: depth + 27 }, depth)) found++; break;
    case 7: if (lies({ f00: depth + 0, f01: depth + 1, f02: depth + 2, f03: depth + 3, f04: depth + 4, f05: depth + 5, f06: depth + 6, f07: depth + 7, f08: depth + 8, f09: depth + 9, f10: depth + 10, f11: depth + 11, f12: depth + 12, f13: depth + 13, f14: depth + 14, f15: depth + 15, f16: depth + 16, f17: depth + 17, f18: depth + 18, f19: depth + 19, f20: depth + 20, f21: depth + 21, f22: depth + 22, f23: depth + 23, f24: depth + 24, f25: depth + 25, f26: depth + 26, f27: depth + 27, f28: depth + 28, f29: depth + 29, f30: depth + 30, f31: depth + 31 }, depth)) found++; break;
  }
  const below = visit(depth - 1, (kind + 1) % 8);
  return found + below;
}

let total = 0;
for (let pass = 0; pass < passes; pass++) total += visit(size, pass % 8);
console.log(total, size);
