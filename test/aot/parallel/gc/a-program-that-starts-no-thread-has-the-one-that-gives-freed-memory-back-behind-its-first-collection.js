// Alone: beside other programs the executable may start a thread for another reason
// Todo under ASAN: Not every time: the allocator there is the system's, and the thread may never start
// A list grows to millions of elements in a loop that does little else: the program collects on its own thread, starts no other and never waits.
// The end of its first collection starts the allocator's thread that gives freed memory back to the system. Whether that thread is there does not go by the clock.
const limit = Number(process.argv[3] ?? 999999999);
function checked(i, depth = 2) {
  if (depth > 0) return checked(i, depth - 1);
  if (i >= limit) throw new RangeError("stop at " + i);
  return i;
}
function fill(n) {
  const list = [];
  for (let i = 0; i < n; i++) list.push(checked(i));
  return list;
}
const list = fill(Number(process.argv[2] ?? 16777216) | 0);
const threads = process.platform === "linux" ? require("fs").readdirSync("/proc/self/task").length : 2;
console.log("filled", list.length, threads > 1 ? "| a thread gives freed memory back" : "| no thread gives freed memory back");
