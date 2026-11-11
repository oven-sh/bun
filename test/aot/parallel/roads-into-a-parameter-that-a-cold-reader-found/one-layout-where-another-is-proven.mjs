const unseen = (0, eval)("(x) => x");
class Wide { constructor(n) { this.a = n; this.b = n + 1; this.c = n + 2; } }
class Thin { constructor(n) { this.c = n; } }
function last(holder) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return holder === undefined ? -1 : holder.c + work - 1;
}
function run(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += last(new Wide(i));
  return sum;
}
console.log(run(3));
console.log(last(unseen(new Thin(7))));
console.log(Reflect.apply(last, undefined, [unseen(new Thin(8))]));
