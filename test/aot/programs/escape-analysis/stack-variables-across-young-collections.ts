// Stack-allocated captured variables stay valid across calls during which young-generation garbage collections run.
let noise = 0;
let junk: string[] = [];
function churn(k: number): void { for (let i = 0; i < 400; i++) { junk.push("j" + (k + i)); if (junk.length > 3000) junk = []; } }
function apply2(f: (x: number) => number, x: number): number { if (noise > 1e9) return apply2(f, x); return f(x) + f(x + 1); }
function behindACut(n: number, depth: number): number {
  if (n < 0) return -1;
  if (depth < 100) {
  let t = n;
  let text = "s" + n;
  let list: number[] = [n];
  let h = depth * 31 + 7;
  h = ((h ^ (h >> 1)) + 13) % 100003; if (h % 89 === 0) noise++;
  h = ((h ^ (h >> 2)) + 18) % 100003; if (h % 91 === 0) noise++;
  h = ((h ^ (h >> 3)) + 23) % 100003; if (h % 93 === 0) noise++;
  h = ((h ^ (h >> 4)) + 28) % 100003; if (h % 95 === 0) noise++;
  h = ((h ^ (h >> 5)) + 33) % 100003; if (h % 97 === 0) noise++;
  h = ((h ^ (h >> 1)) + 38) % 100003; if (h % 99 === 0) noise++;
  h = ((h ^ (h >> 2)) + 43) % 100003; if (h % 101 === 0) noise++;
  h = ((h ^ (h >> 3)) + 48) % 100003; if (h % 103 === 0) noise++;
  h = ((h ^ (h >> 4)) + 53) % 100003; if (h % 105 === 0) noise++;
  h = ((h ^ (h >> 5)) + 58) % 100003; if (h % 107 === 0) noise++;
  h = ((h ^ (h >> 1)) + 63) % 100003; if (h % 109 === 0) noise++;
  h = ((h ^ (h >> 2)) + 68) % 100003; if (h % 111 === 0) noise++;
  h = ((h ^ (h >> 3)) + 73) % 100003; if (h % 113 === 0) noise++;
  h = ((h ^ (h >> 4)) + 78) % 100003; if (h % 115 === 0) noise++;
  const add = (x: number): number => { t += x; text = text + x; list = [x, t]; return t + text.length + list.length; };
  let sum = 0;
  for (let i = 0; i < 6; i++) { churn(n + i); sum += apply2(add, h % 5); churn(n - i); sum += text.length + list[1]; }
  if (depth > 0) return sum + behindACut(n - 1, depth - 1);
  return sum + apply2(add, 1) + t;
  }
  return 0;
}
let total = 0;
for (let i = 0; i < 3000; i++) total = (total + behindACut(i % 50, 2) + behindACut(-i - 1, 1) + behindACut(i % 7, 0) + behindACut(3, 1)) % 1000003;
console.log(total);
