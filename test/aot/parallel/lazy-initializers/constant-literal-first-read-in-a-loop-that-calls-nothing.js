// The first read of a variable that holds a literal of constants stands in a loop that calls nothing and stores nothing: there is one object, whichever turn reads it.
const table = { a: 1, b: 2 };
function same(n) { let first = null, count = 0; for (let i = 0; i < n; i++) { const now = table; if (first === null) first = now; if (first === now) count++; } return count; }
console.log(same(0), same(5), same(3));
const list = [1, 2, 3];
function grows(n) { for (let i = 0; i < n; i++) { list[i + 3] = i; } return list.length; }
console.log(grows(4), list.join());
