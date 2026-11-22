// Flags: --aot-check=VerifyEachStage
globalThis.mark = 4;
var wanted = 4;
let rows, size;
function paint(cells, turns) {
  rows = [];
  size = cells.length;
  for (const turn of turns) {
    let found = mark;
    switch (found) {
      case wanted: {
        for (let place = 0; place < 5; place++) cells[place] = found;
      }
    }
  }
  return cells;
}
function paintTwice(cells) {
  size = cells.length;
  for (const turn of [5, 6]) {
    let found = mark;
    switch (found) {
      case wanted: {
        let kept = found;
        for (let place = 0; place < 7; place++) cells[place] = kept;
      }
    }
  }
  return cells;
}
console.log(paint(["a"], [1]).join(), size, rows.length);
console.log(paint([1.5, 2, 3, 4, 5, 6], [1, 2]).join(), size, rows.length);
console.log(paint([], []).join(), size, rows.length);
console.log(paint(Object.freeze([7]), []).join(), size);
console.log(paintTwice(["b", "c"]).join(), size);
console.log(paintTwice([, , 3]).join(), size);
globalThis.mark = "other";
console.log(paint(["a"], [1]).join(), size, paintTwice([0, 1]).join(), size);
try {
  delete globalThis.mark;
  console.log(paintTwice(["d"]).join());
} catch (error) {
  console.log(error.constructor.name, size);
}
