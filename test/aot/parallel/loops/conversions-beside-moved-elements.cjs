// Operators that convert objects in a loop that moves elements run as often as they are written, whether their result is used or not.
let calls = 0;
const object = { valueOf() { calls++; return 2; } };
const other = { valueOf() { calls += 100; rows[0][0] = calls; return 3; } };
const rows = [[1, 2, 3], [4, 5, 6], [7, 8, 9]], copy = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
function unused(a, b, n, x) { for (let i = 0; i < n; i++) { x + 1; b[i][0] = a[i][1]; } }
function product(a, b, n, x) { for (let i = 0; i < n; i++) { b[i][1] = a[i][2]; x * a[i][0]; } }
function between(a, b, n, x) { let y; for (let i = 0; i < n; i++) { y = x - i; b[i][2] = a[i][0]; } return y; }
function stepped(a, b, n, x) { let y = x; for (let i = 0; i < n; i++) { const z = x; y = z; b[i][2] = a[i][1]; y++; } return y; }
function divided(a, b, n, x) { for (let i = n - 1; i >= 0; i--) { void (x / 2); b[i][0] = 7; } }
function summed(a, b, n, x) { let s = 0; for (let i = 0; i < n; i++) { s += a[i][1]; x + s; } return s; }
for (const loop of [unused, product, between, stepped, divided, summed]) {
  for (const x of [object, other, 5, "text", null]) {
    calls = 0;
    const result = loop(rows, copy, 3, x);
    console.log(loop.name, calls, String(result), JSON.stringify(rows), JSON.stringify(copy));
  }
  for (const x of [Symbol(), 1n]) {
    let name = "none";
    try { loop(rows, copy, 3, x); } catch (error) { name = error.constructor.name; }
    console.log(loop.name, name, JSON.stringify(copy));
  }
}
