// The same class with declared numbers, all of them fractions
class Average {
  private sum = 0.5;
  private weights = 0.25;
  add(value: number, weight: number): this {
    this.sum += value * weight;
    this.weights += weight;
    return this;
  }
  get value(): number {
    return this.sum / this.weights;
  }
}
function run(values: number[]): string {
  const average = new Average();
  const out: string[] = [];
  for (let i = 0; i < values.length; i++) out.push(average.add(values[i], 0.125 * (i + 1)).value.toFixed(5));
  return out.join(" ");
}
console.log(run([1.5, 2.5, 3.5]));
console.log(run([0.1, 0.2]));
console.log(run([-7.25]));
