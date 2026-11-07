// The lines are those of `bun <file>`. It reads the texts on other threads, and on a busy machine some of its runs print another order.
const all = await import("./inner.mjs");
console.log("main got", all.answer);
/* Output:
first begins
second begins
inner runs
back runs
second got 42
second ends
first got back
first ends
main got 42
*/
