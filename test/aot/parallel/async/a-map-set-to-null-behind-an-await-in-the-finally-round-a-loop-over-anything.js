// The source is anything that can be iterated: a list, a set, a generator, an object with its own iterator. The `finally` awaits, then sets the local to null.
function mayThrow(n) { if (n === 3) throw new Error("three"); return n; }
function* numbers(count) { try { for (let n = 1; n <= count; n++) yield n; } finally { console.log("numbers closed"); } }
const own = count => ({ [Symbol.iterator]() { let n = 0; return { next: () => ({ done: ++n > count, value: n }), return() { console.log("own closed"); return {}; } }; } });
async function* stream(input) {
  let seen = new Map();
  try {
    for (const chunk of input) {
      mayThrow(chunk);
      seen.set(chunk, chunk * 2);
      yield seen.size;
    }
  } finally {
    await 0;
    seen = null;
    await 1;
  }
}
for (const input of [[1, 2], new Set([1, 2, 3, 4]), numbers(5), own(2), own(4)]) {
  try { for await (const value of stream(input)) console.log("value", value); } catch (error) { console.log("caught", error.message); }
}
