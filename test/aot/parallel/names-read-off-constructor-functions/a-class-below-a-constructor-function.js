const unseen = (x) => [x][JSON.parse("0")];
function Counter(n) { this.n = n; }
Counter.of = function (n) { return new this(n + 1); };
class Later extends Counter {}
function run(count, key, holder) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    sum += Later.of(i).n + Counter.of(i).n;
    if (i === 4) holder[key] = function (n) { return { n: -n }; };
  }
  return sum;
}
console.log(run(10, unseen("of"), unseen(Counter)), Later.of(1) instanceof Later);
