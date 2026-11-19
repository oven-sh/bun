// Locals that are masked, shifted or divided at every step of a loop, and locals that are not at one of the steps.
function shiftRegister(seed: number, steps: number): number {
  let state = seed & 0xffff;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const bit = (state ^ (state >> 2) ^ (state >> 3) ^ (state >> 5)) & 1;
    state = ((state >> 1) | (bit << 15)) & 0xffff;
    sum = (sum + state) | 0;
  }
  return sum;
}
function machine(memory: Uint8Array, steps: number): string {
  let pc = 0, sp = 255, a = 0, carry = 0;
  for (let i = 0; i < steps; i++) {
    const op = memory[pc];
    pc = (pc + 1) & 0xffff;
    if (op & 1) {
      memory[sp] = a;
      sp = (sp - 1) & 255;
    } else if (op & 2) {
      const wide = a + op + carry;
      carry = wide >> 8;
      a = wide & 255;
    } else if (op & 4) pc = ((memory[pc] << 8) | op) & 0xffff;
    else {
      sp = (sp + 1) & 255;
      a ^= memory[sp];
    }
  }
  return [pc, sp, a, carry].join();
}
function ring(values: number[], steps: number): number {
  const buffer = new Float64Array(64);
  let at = 0, total = 0;
  for (let i = 0; i < steps; i++) {
    total += values[i % values.length] - buffer[at];
    buffer[at] = values[i % values.length];
    at = (at + 1) % 64;
  }
  return total;
}
function remainders(start: number, steps: number): string {
  let at = start, low = 0;
  for (let i = 0; i < steps; i++) {
    at = (at * 3 - 100) % 7;
    if (at < low) low = at;
  }
  return at + "/" + low + "/" + Object.is(at, -0);
}
// One of the ways round leaves the range, or leaves the numbers.
function sometimesWide(steps: number, wide: number): unknown {
  let at: any = 0;
  for (let i = 0; i < steps; i++) {
    at = (at + 5) & 63;
    if (i === wide) at = 5e9;
  }
  return at;
}
function sometimesText(steps: number, text: number): unknown {
  let at: any = 1;
  for (let i = 0; i < steps; i++) {
    at = (at << 1) & 255 || 1;
    if (i === text) at = "7";
    else if (i === text + 1) at = [12];
  }
  return at;
}
function nested(rows: number, columns: number): number {
  let state = 1, seen = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      state = (state * 5 + y) & 1023;
      if (state === 512) continue;
      seen = (seen << 1 | state >>> 9) & 0x7fffffff;
    }
    state = (state >>> 1) | 256;
  }
  return state * 4096 + (seen & 4095);
}
function caught(steps: number): string {
  let at = 0, faults = 0;
  for (let i = 0; i < steps; i++) {
    try {
      at = (at + 17) & 127;
      if (at === 85) throw at;
    } catch (fault) {
      faults = (faults + (fault as number)) & 0xfff;
      at = -1;
    }
  }
  return at + "/" + faults;
}
function* stepped(steps: number): Generator<number> {
  let at = 3;
  for (let i = 0; i < steps; i++) {
    const given: any = yield at;
    at = given === undefined ? (at * 7) & 31 : given & 4095;
  }
}
console.log(shiftRegister(0xace1, 70000), shiftRegister(-5.5, 100));
const memory = new Uint8Array(65536);
for (let i = 0; i < memory.length; i++) memory[i] = (i * 37 + (i >> 5)) & 255;
console.log(machine(memory, 60000));
console.log(ring([1, 2.5, -3, 4], 1000));
console.log(remainders(0, 50), remainders(-0, 1), remainders(1e9, 50), remainders(0.5, 5), remainders(NaN, 5));
console.log(sometimesWide(20, 19), sometimesWide(20, 7), sometimesWide(20, 30));
console.log(sometimesText(20, 19), sometimesText(20, 18), sometimesText(20, 4), sometimesText(20, 30));
console.log(nested(40, 33), caught(1000));
const steps = stepped(6);
console.log([steps.next(), steps.next(), steps.next(70000), steps.next("9" as any), steps.next(), steps.next(-1)].map(step => step.value).join());
