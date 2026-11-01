// For of break closes the iterator: compiled answers as plain.
function* g() {
  try {
    yield 1;
    yield 2;
    yield 3;
  } finally {
    console.log("closed");
  }
}
for (const v of g()) {
  if (v === 2) break;
}
const [first] = g();
console.log(first);
