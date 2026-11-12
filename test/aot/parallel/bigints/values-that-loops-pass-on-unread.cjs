// Values of BigInts that go around loops and that nothing reads behind the loop, or only some way out of it.
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=40
const out = [];
let obj = { x: 5 };
function unread(n) {
  const state = { a: 1 };
  const list = [3, 1, 2];
  let big = 3n;
  let any = undefined;
  for (let i = 40; i > 0; i -= 3) {
    let left = 3;
    while (left-- > 0) {
      any = big / 3n;
      for (let k = 0; k < 3 && list.length; k++) state.a += list.shift() | 0;
    }
    any = !any;
    any = obj.x?.toString().length ?? "none";
  }
  out.push([state.a, list.length, any].join(" "));
}
function undeclared(n) {
  let big = 3n, any = undefined;
  const state = { a: 1 }, list = [3, 1, 2];
  for (let i = 40; i > 0; i -= 3) {
    { while (notDeclared-- > 0) { any = big / 3n; for (let k = 0; k < 3 && list.length; k++) state.a += list.shift() | 0; } }
    any = !any;
    any = obj.x?.toString().length ?? "none";
  }
  out.push([state.a, big, any].join(" "));
}
function someWays(a, b, n) {
  let x = a, y = b, z = 0n, w = 1n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 3; j++) { const t = x * y - z; z = y; y = x; x = t % 1000003n; w = w + t; if (j === i) continue; w = w % 97n; }
    while (z > 50n) { z = z / 3n; w = z - w; if (w > 40n) break; }
    try { if (i % 4 === 3) throw x; y = -y; } catch (error) { x = error + 1n; w = x - 5n; }
    w = BigInt(i);
  }
  return x + y;
}
function never(a, n) { let unreadSum = a, last = 0n; do { unreadSum = unreadSum * 3n - last; last = unreadSum % 11n; unreadSum = last; } while (--n > 0); return n; }
for (const n of [3, 5, 9]) {
  for (const f of [unread, undeclared, n => out.push(someWays(5n ** 30n, -(7n ** 20n), n)), n => out.push(never(3n ** 90n, n))]) { try { f(n); } catch (error) { out.push(error.name); } }
}
console.log(out.join("\n"));
