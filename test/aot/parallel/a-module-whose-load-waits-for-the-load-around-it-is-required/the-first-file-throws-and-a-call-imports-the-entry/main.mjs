// The lines are those of `bun <file>`. It reads the texts on other threads, and on a busy machine some of its runs print another order.
process.on("exit", code => console.log("leaves with", code));
const timer = setTimeout(() => console.log("the call has not settled"), 300);
try {
  console.log("got", (await import("./entry.mjs")).answer);
} catch (error) {
  console.log("caught", error.message);
}
clearTimeout(timer);
/* Output:
first begins
second begins
third runs
main runs
back runs
second got 1
second ends
first got 1
first ends
got 1
leaves with 0
*/
