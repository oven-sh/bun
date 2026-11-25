const box = { held: 0 };
function note() {
  box.held = box.held + 7;
}
function run(limit) {
  let a = null,
    caught = null;
  const before = box.held;
  while (caught !== limit) {
    try {
      if (a === null) throw limit;
      a = null;
    } catch (e) {
      note();
      if (box.held === 21) caught = e;
    }
  }
  return [before, box.held, caught].join();
}
console.log(run("end"));
