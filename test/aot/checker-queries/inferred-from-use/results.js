// A function without a written result returns the union of what its returned expressions are.
// returns `same` = { id?: any; }[]
function same(rows) { rows[0].id; return rows; }
function caller(x) {
  // predicted `same(x)` = { id?: any; }[]
  // predicted `same(x).length` = number
  return same(x).length;
}
// returns `either` = string | number
function either(a, b) { if (a < "m") return a; return b * 2 ? b : b - 1; }
// returns `member` = number
function member(o) { o.count++; return o.count; }
// returns `through` = number
function through(o) { return member(o); }
// returns `again` = number
function again(n) { if (n > 0) return again(n - 1); return n; }
// returns `first` = number
function first(n) { if (n > 0) return second(n - 1); return n; }
// returns `second` = number
function second(n) { return first(n); }
// returns `last` = number
function last(n) { return (n * 2, n); }
// returns `fallback` = string
function fallback(s, t) { s < "m"; return s || t; }
// returns `nothing` = any
function nothing(o) { return o; }
// returns `later` = Promise<any>
async function later(n) { n * 2; return n; }
