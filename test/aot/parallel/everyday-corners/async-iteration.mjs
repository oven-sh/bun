// Async iteration: compiled answers as plain.
async function* g() {
  yield 1;
  yield Promise.resolve(2);
  try {
    yield 3;
  } finally {
    console.log("closed");
  }
}
const out = [];
for await (const v of g()) {
  out.push(v);
  if (v === 3) break;
}
console.log(out.join());
