// When the body of the loop throws, what closes the source awaits, and behind it the `finally` sets the local to null.
// The compiler lets go of the list where it was last read. On that way this is the head of the block that closes the source, which begins with what it has caught.
function mayThrow(n) { if (n === 3) throw new Error("three"); return n; }
async function* source(count) { try { for (let n = 1; n <= count; n++) yield n; } finally { console.log("source closed"); } }
async function* stream(input) {
  let seen = [];
  try {
    for await (const chunk of input) {
      mayThrow(chunk);
      seen.push(chunk);
      yield seen.length;
    }
  } finally {
    seen = null;
    await 0;
  }
}
for (const count of [2, 5]) {
  try { for await (const value of stream(source(count))) console.log("value", value); } catch (error) { console.log("caught", error.message); }
}
