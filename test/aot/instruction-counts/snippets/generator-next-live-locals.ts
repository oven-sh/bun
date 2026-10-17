// resumes a generator that keeps eight locals alive across its yield
function* mix(seed: number): Generator<number, void, void> {
  let a = seed, b = seed + 1, c = seed + 2, d = seed + 3, e = seed + 4, f = seed + 5, g = seed + 6, h = seed + 7;
  for (;;) {
    yield a + b + c + d + e + f + g + h;
    a = b; b = c; c = d; d = e; e = f; f = g; g = h; h = a + 1;
  }
}
const operations = 100;
const mixed = mix(1);
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const result = mixed.next();
    if (result.done) break;
    total += result.value;
  }
}

console.log(total);
