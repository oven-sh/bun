// A loop reads a field that holds lists as a rule under its counter. Where the field is found to be a view before the loop, it has no length of an array.
class Counted {
  constructor(source, target) {
    this.source = source;
    this.target = target;
    let count = 0;
    for (let i = 2; i < target.length; i += 3) {
      if (typeof target[i] !== "number") continue;
      if (this.source[i] > this.target[i - 3]) count++;
      else this.target[i] = this.target[i - 2];
    }
    this.count = count;
  }
}
function run(lists, target) {
  return new Counted(lists[0], target).count + ":" + Array.from(target).join();
}
const makers = [() => JSON.parse("[6,5,4,3,2,1,9,8,7]"), () => new Float64Array([6, 5, 4, 3, 2, 1, 9]), () => new Int32Array([1, 2, 3, 4, 5, 6]), () => [1, , 3, "x", 5, 6]];
for (const source of makers) {
  for (const target of makers) console.log(run([source()], target()));
}
