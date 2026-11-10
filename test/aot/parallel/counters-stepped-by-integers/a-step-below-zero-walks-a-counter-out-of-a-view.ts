function stripes(view: Uint8Array, limit: number, low: number, high: number, from: number): string {
  let stores = 0;
  for (let i = low; i <= high; i++) {
    let turns = 0;
    for (let j = from; j <= limit; j += i) {
      view[j] = i & 255;
      stores++;
      if (++turns === 24) break;
    }
  }
  return stores + " " + view.join("");
}
function reads(view: Uint8Array, limit: number, low: number, high: number, from: number): string {
  const seen: (number | undefined)[] = [];
  for (let i = low; i <= high; i++) {
    let turns = 0;
    for (let j = from; j <= limit; j += i) {
      seen.push(view[j]);
      if (++turns === 12) break;
    }
  }
  return seen.join(",");
}
function squares(limit: number): number {
  const composite = new Uint8Array(limit + 1);
  let count = 0;
  for (let i = 2; i <= limit; i++) {
    if (composite[i] === 0) {
      count++;
      for (let j = i * i; j <= limit; j += i) composite[j] = 1;
    }
  }
  return count;
}
function written(view: Uint8Array, limit: number, from: number): string {
  let stores = 0;
  for (let i = -3; i <= 3; i++) {
    let turns = 0;
    for (let j = from; j <= limit; j += i) {
      view[j] = (i + 4) & 255;
      stores++;
      if (++turns === 24) break;
    }
  }
  return stores + " " + view.join("");
}
function upward(view: Uint8Array, limit: number, from: number): string {
  let stores = 0;
  for (let i = 1; i <= 5; i++) {
    for (let j = from; j <= limit; j += i) {
      view[j] = i;
      stores++;
    }
  }
  return stores + " " + view.join("");
}
const guard = new Uint8Array(64).fill(7);
const whole = new Uint8Array(96);
const middle = whole.subarray(32, 64);
console.log(stripes(middle, 31, 1, 3, 0));
console.log(stripes(middle, 31, -3, 3, 8));
console.log(stripes(middle, 100, -2, 2, 30));
console.log(stripes(middle, 31.5, -1, 1, 0));
console.log(stripes(middle, 4000000000, 1000000000, 1000000002, 5));
console.log(stripes(middle, -1, -3, 3, -4));
console.log(written(middle, 31, 8));
console.log(written(middle, 31, 0));
console.log(written(middle, 200, 31));
console.log(written(middle, 31, -2));
console.log(upward(middle, 31, 0));
console.log(upward(middle, 40, 3));
console.log(upward(middle, 40.5, -3));
console.log(upward(middle, 31, 2147483647));
console.log(whole.join(""));
console.log(guard.join(""));
for (let k = 0; k < 32; k++) middle[k] = k + 1;
console.log(reads(middle, 31, 1, 3, 0));
console.log(reads(middle, 31, -3, 3, 8));
console.log(reads(middle, 100, -2, 2, 30));
console.log(reads(middle, 3000000000, 2147483646, 2147483647, 1));
console.log(squares(1000), squares(1), squares(0), squares(46341 * 3));
