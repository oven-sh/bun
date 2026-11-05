const unseen = (0, eval)("(x) => x");
class Box { width = 1; height = 2; depth = 3; }
function report(taken) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return typeof taken;
}
function measure(box: Box) {
  const found = unseen({ size: 3 });
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += box.width * box.height + box.depth;
  return report(found) + " " + Math.abs(sum);
}
console.log(measure(JSON.parse('{"width":2,"height":3,"depth":4}')));
console.log(measure(new Box()));
