// Alone: which kind of array a reader asks for goes by every array that the executable holds
// A copy of a list is kept under a second name, read and written in one loop: a class keeps the copy.
class Series {
  values: number[] = [];
  load(list: number[]): number {
    const copy = [...list];
    this.values = copy;
    let sum = 0;
    for (let i = 0; i < copy.length; i++) {
      if (copy[i] < 0) this.values[i] = Math.abs(copy[i]);
      else sum += copy[i];
    }
    return sum;
  }
}
const s = new Series();
console.log(s.load([1, -2, 3, 5]), s.values[1]);
