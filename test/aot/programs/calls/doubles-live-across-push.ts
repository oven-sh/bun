// Floating-point values stay intact across `xs.push(v)`, also when the array has to grow or stores its elements differently than expected.
function hide<T>(x: T): T { return x; }

function doublesIntoDoubles(n: number, seed: number): number {
  const xs: number[] = [];
  let a = seed + 0.125, b = seed * 1.5, c = seed - 0.75, d = seed / 3, e = seed + 2.25, f = seed * 0.3, g = seed - 9.5, h = seed / 7, i2 = seed + 11.0625, j = seed * 2.75, k = seed - 0.0078125, l = seed / 13;
  for (let i = 0; i < n; i++) {
    xs.push(a + i * 0.5);
    a += 0.5; b -= 0.25; c *= 1.0000001; d += b * 1e-9; e -= 0.125; f += 0.0625; g += a * 1e-9; h -= 1e-7; i2 += 0.03125; j -= c * 1e-12; k += 1e-5; l += 0.015625;
  }
  let sum = 0;
  for (const x of xs) sum += x;
  return sum + a + b + c + d + e + f + g + h + i2 + j + k + l + xs.length;
}

function integersIntoDoubles(n: number, seed: number): number {
  const xs: number[] = [0.5];
  let a = seed + 0.125, b = seed * 1.5, c = seed - 0.75, d = seed / 3, e = seed + 2.25, f = seed * 0.3, g = seed - 9.5, h = seed / 7, i2 = seed + 11.0625, j = seed * 2.75;
  for (let i = 0; i < n; i++) {
    xs.push(i);
    a += 0.5; b -= 0.25; c += 0.375; d += 1e-3; e -= 0.125; f += 0.0625; g += 1e-4; h -= 1e-7; i2 += 0.03125; j -= 1e-2;
  }
  let sum = 0;
  for (const x of xs) sum += x;
  return sum + a + b + c + d + e + f + g + h + i2 + j + xs.length;
}

function doublesIntoIntegers(n: number, seed: number): number {
  const xs: number[] = [1, 2, 3];
  let a = seed + 0.125, b = seed * 1.5, c = seed - 0.75, d = seed / 3, e = seed + 2.25, f = seed * 0.3, g = seed - 9.5, h = seed / 7, i2 = seed + 11.0625, j = seed * 2.75;
  for (let i = 0; i < n; i++) {
    xs.push(i % 5 == 4 ? i + 0.5 : i);
    a += 0.5; b -= 0.25; c += 0.375; d += 1e-3; e -= 0.125; f += 0.0625; g += 1e-4; h -= 1e-7; i2 += 0.03125; j -= 1e-2;
  }
  let sum = 0;
  for (const x of xs) sum += x;
  return sum + a + b + c + d + e + f + g + h + i2 + j + xs.length;
}

function notANumberAmongDoubles(n: number, seed: number): string {
  const xs: number[] = [0.5];
  let a = seed + 0.125, b = seed * 1.5, c = seed - 0.75, d = seed / 3, e = seed + 2.25, f = seed * 0.3, g = seed - 9.5, h = seed / 7, i2 = seed + 11.0625, j = seed * 2.75;
  let holes = 0;
  for (let i = 0; i < n; i++) {
    xs.push(i % 3 == 0 ? NaN : i + 0.25);
    a += 0.5; b -= 0.25; c += 0.375; d += 1e-3; e -= 0.125; f += 0.0625; g += 1e-4; h -= 1e-7; i2 += 0.03125; j -= 1e-2;
  }
  let sum = 0;
  for (let i = 0; i < xs.length; i++) { if (!(i in xs)) holes++; if (xs[i] === xs[i]) sum += xs[i]; }
  return [sum, a + b + c + d + e + f + g + h + i2 + j, xs.length, holes].join(" ");
}

function numbersIntoValues(n: number, seed: number): string {
  const xs: (number | string)[] = ["s"];
  let a = seed + 0.125, b = seed * 1.5, c = seed - 0.75, d = seed / 3, e = seed + 2.25, f = seed * 0.3, g = seed - 9.5, h = seed / 7, i2 = seed + 11.0625, j = seed * 2.75;
  for (let i = 0; i < n; i++) {
    xs.push(i % 2 ? a : "t" + (i & 3));
    a += 0.5; b -= 0.25; c += 0.375; d += 1e-3; e -= 0.125; f += 0.0625; g += 1e-4; h -= 1e-7; i2 += 0.03125; j -= 1e-2;
  }
  let sum = 0, text = 0;
  for (const x of xs) { if (typeof x === "number") sum += x; else text += x.length; }
  return [sum, text, a + b + c + d + e + f + g + h + i2 + j, xs.length].join(" ");
}

// The array comes from elsewhere: the site cannot know how its elements are stored.
function intoAGivenArray(xs: number[], n: number, seed: number): number {
  let a = seed + 0.125, b = seed * 1.5, c = seed - 0.75, d = seed / 3, e = seed + 2.25, f = seed * 0.3, g = seed - 9.5, h = seed / 7, i2 = seed + 11.0625, j = seed * 2.75;
  for (let i = 0; i < n; i++) {
    xs.push(a);
    xs.push(i);
    a += 0.5; b -= 0.25; c += 0.375; d += 1e-3; e -= 0.125; f += 0.0625; g += 1e-4; h -= 1e-7; i2 += 0.03125; j -= 1e-2;
  }
  let sum = 0;
  for (const x of xs) sum += x;
  return sum + a + b + c + d + e + f + g + h + i2 + j + xs.length;
}

// Many short arrays: 0 -> 1 -> 3 -> 7 are grown by the stub itself.
function manyShortArrays(n: number, seed: number): number {
  let a = seed + 0.125, b = seed * 1.5, c = seed - 0.75, d = seed / 3, e = seed + 2.25, f = seed * 0.3, g = seed - 9.5, h = seed / 7;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const xs: number[] = [];
    const ys: (number | null)[] = [];
    for (let k = 0; k < (i & 7) + 1; k++) { xs.push(a + k); ys.push(k & 1 ? b : null); a += 0.5; b -= 0.25; c += 0.375; d += 1e-3; e -= 0.125; f += 0.0625; g += 1e-4; h -= 1e-7; }
    for (const x of xs) sum += x;
    for (const y of ys) if (y !== null) sum += y;
  }
  return sum + a + b + c + d + e + f + g + h;
}

for (const n of [0, 1, 2, 3, 4, 7, 8, 9, 100, 5000]) {
  for (const seed of [1, 0.1, -3.5]) {
    console.log(n, seed, doublesIntoDoubles(n, seed), integersIntoDoubles(n, seed), doublesIntoIntegers(n, seed));
    console.log(n, seed, notANumberAmongDoubles(n, seed), "|", numbersIntoValues(n, seed));
    console.log(n, seed, intoAGivenArray(hide([]), n, seed), intoAGivenArray(hide([1]), n, seed), intoAGivenArray(hide([0.5]), n, seed), intoAGivenArray(hide([1, 2, 3]), n, seed), manyShortArrays(n, seed));
  }
}
