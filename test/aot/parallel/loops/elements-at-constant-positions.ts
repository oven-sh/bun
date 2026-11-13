// Loops that read and store elements at constant positions: integers, numbers, both zeros, NaN, holes, texts, aliases, stores under other keys, stores in some iterations alone, breaks, throws, growth, other kinds amid the loop, callees, nests.
const show = (v: any) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : String(v));
const ints = [1, 2, 3, 4];
const numbers: any[] = [0.5, -0, 2.5, 1e9];
const holes: any[] = [1, , 3, 4];
const other: any[] = [9, 8, 7];
const same = ints;
const state: any[] = [12345, 0];
function next(): any {
  state[0] = (state[0] * 1103515245 + 12345) & 0x7fffffff;
  state[1]++;
  return state[0];
}
function some(i: any): any {
  if (i & 1) state[1] = state[1] + i;
  return state[1];
}
const loops: Record<string, (k: number, x: any) => any> = {
  chain(k) {
    for (let i = 0; i < k; i++) {
      ints[0] = (ints[0] + i) | 0;
      ints[1] ^= ints[0];
      ints[2] = (ints[2] + ints[1]) | 0;
      ints[3] ^= ints[2];
    }
    return ints;
  },
  doubles(k) {
    for (let i = 0; i < k; i++) {
      numbers[0] = numbers[0] * 0.5 + i;
      numbers[1] = -numbers[1];
      numbers[2] -= numbers[0];
    }
    return numbers;
  },
  alias(k) {
    for (let i = 0; i < k; i++) {
      ints[0] = (ints[0] + 1) | 0;
      same[0] = (same[0] * 3) & 1023;
      ints[1] = same[0] ^ ints[1];
    }
    return ints;
  },
  key(k, x) {
    for (let i = 0; i < k; i++) {
      ints[0] = (ints[0] + 1) & 255;
      ints[x & 3] = (ints[0] + i) & 127;
      ints[i & 3] ^= 1;
      ints[2] = (ints[2] + ints[0]) & 1023;
    }
    return ints;
  },
  some(k) {
    for (let i = 0; i < k; i++) {
      if (i % 3 === 0) ints[0] = (ints[0] + i) & 4095;
      ints[1] = (ints[1] + ints[0]) & 4095;
      if (i === 33) break;
    }
    return ints;
  },
  kinds(k, x) {
    for (let i = 0; i < k; i++) {
      other[0] = other[0] + 1;
      if (i === 5) other[0] = x;
      other[1] = other[0] + other[1];
    }
    return other;
  },
  grown(k) {
    for (let i = 0; i < k; i++) {
      ints[0] = (ints[0] + 1) | 0;
      if (i === 7) ints.push(5);
      if (i === 9) ints.length = 2;
      ints[1] = (ints[1] + ints[0]) | 0;
      if (i === 12) ints[3] = 1;
    }
    return ints;
  },
  holes(k) {
    for (let i = 0; i < k; i++) {
      holes[1] = holes[1] + holes[0];
      holes[0] = (holes[0] + 1) | 0;
      if (i === 4) delete holes[0];
    }
    return holes;
  },
  thrown(k) {
    for (let i = 0; i < k; i++) {
      ints[0] = (ints[0] + 1) | 0;
      if (i === 11) throw new Error("at " + ints[0]);
      ints[1] = ints[0] ^ i;
    }
    return ints;
  },
  callees(k) {
    let s = 0;
    for (let i = 0; i < k; i++) s = (s + next() + some(i) + (i & 4 ? next() : 0)) | 0;
    return s + "/" + state;
  },
  nests(k) {
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < 4; j++) ints[0] = (ints[0] + j) & 1023;
      ints[1] = (ints[1] + ints[0]) & 1023;
      state[1] = ints[1];
    }
    return ints + "/" + next();
  },
};
for (const name of Object.keys(loops)) {
  for (const [k, x] of [[0, 1], [1, 2], [40, 3], [60, 0.5], [17, "t"]] as [number, any][]) {
    try {
      console.log(name, show(loops[name](k, x)));
    } catch (error: any) {
      console.log(name, error.message);
    }
  }
}
console.log(show(ints), show(numbers), show(holes), show(other), show(state));
