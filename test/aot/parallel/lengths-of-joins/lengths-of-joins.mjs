// STATISTIC: JoinsMeasuredByParts >= 4
// The length of a join that nothing else reads is the sum of its parts' lengths; a join that is too long still throws.
const texts = ["", "x", "long enough", "\u{1f600}", "é", "y".repeat(40)], rope = (a, b) => a + b;
class Greeter { constructor(name) { this.name = name; } greet() { return "hi " + this.name; } }
let total = 0;
const lines = [];
for (let i = 0; i < 4000; i++) {
  const a = texts[i % texts.length], b = texts[(i * 7) % texts.length];
  total += (a + b).length;
  total += ("<" + a + ">").length;
  total += `${a}-${b}`.length;
  total += rope(a, b).length;
  total += new Greeter(a).greet().length;
  const kept = a + b;
  total += kept.length + kept.charCodeAt(0) | 0;
  const taken = a + b, length = taken.length;
  if (i % 1000 === 999) lines.push(taken + length);
  total = total % 1000003;
}
const numbers = [1, 1.5, -0, 12345];
for (let i = 0; i < 2000; i++) total += (texts[i % texts.length] + numbers[i & 3]).length;
let power = "z".repeat(1024), longest = "z".repeat(1023), shorter = "z".repeat(1016), half = "";
for (let k = 10; k < 31; k++) { longest += power; shorter += power; half = power; if (k < 30) power += power; }
const pairs = [[longest, ""], [longest, "x"], ["x", longest], [half, half], [half, "x"], [shorter, "1234567"], [shorter, "12345678"], [shorter, "123456789"]];
lines.push(longest.length, half.length, shorter.length);
for (let i = 0; i < 3; i++) {
  for (const [left, right] of pairs) {
    try { lines.push((left + right).length); } catch (error) { lines.push(error.constructor.name); }
    try { lines.push(("1234567" + left).length); } catch (error) { lines.push(error.constructor.name); }
    try { lines.push(`${left}-${right}`.length); } catch (error) { lines.push(error.constructor.name); }
  }
}
let before = 0;
for (let i = 0; i < 4; i++) { try { const n = (half + half).length; before += n; } catch { before += 1; } }
console.log(total, before, lines.join());
