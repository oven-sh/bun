// Generator return runs finally: compiled answers as plain.
function* g() {
  try {
    yield 1;
    yield 2;
  } finally {
    console.log("cleanup");
    yield "late";
  }
}
const it = g();
console.log(JSON.stringify([it.next(), it.return("r"), it.next(), it.next()]));
