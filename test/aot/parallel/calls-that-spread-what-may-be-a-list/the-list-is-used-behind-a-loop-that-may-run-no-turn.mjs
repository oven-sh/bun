// `xs.push(...xs)` in a loop whose bound nobody knows, and xs used behind the loop: the loop may run no turn: what the turn has learned of xs holds in the turn alone.
function self(xs, n) { let r = 0; for (let i = 0; i < n; i++) r = xs.push(...xs); return r + xs.join(""); }
function other(xs, ys, n) { let r = 0; for (let i = 0; i < n; i++) r = ys.push(...xs); return r + xs.join("") + ys.join(""); }
function unread(xs, n) { for (let i = 0; i < n; i++) xs.push(...xs); return xs.length + xs.join(""); }
function whileLoop(xs, n) { let r = 0; while (n-- > 0) r = Math.max(...xs); return r + xs.join(""); }
function nested(xs, n) { let r = 0; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) r = xs.push(...xs); return r + xs.join(""); }
function behindBranch(xs, n, c) { let r = 0; if (c) for (let i = 0; i < n; i++) r = xs.push(...xs); return r + xs.join(""); }
for (const bound of ["0", "1", "2", '""', "null", "-1", '"2"']) {
  const n = JSON.parse(bound);
  console.log(bound, self(JSON.parse("[1,2]"), n), other(JSON.parse("[1,2]"), JSON.parse("[3]"), n), unread(JSON.parse("[1,2]"), n), whileLoop(JSON.parse("[1,2]"), n), nested(JSON.parse("[1]"), n), behindBranch(JSON.parse("[1,2]"), n, n !== null));
}
console.log(self(JSON.parse("[1,2]"), undefined));
try { self(JSON.parse("null"), 1); } catch (e) { console.log(e.name); }
try { console.log(self(JSON.parse("null"), 0)); } catch (e) { console.log(e.name); }
