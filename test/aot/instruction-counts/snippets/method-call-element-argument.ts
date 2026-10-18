// passes array elements to a method of a local object
const operations = 100;
class Gauge {
  least = Infinity;
  most = -Infinity;
  take(reading: number): void {
    if (reading < this.least) this.least = reading;
    if (reading > this.most) this.most = reading;
  }
}
const readings: number[] = [];
for (let i = 0; i < operations; i++) readings.push((i * 17) % 23);
let total = 0;

kernel: {
  const gauge = new Gauge();
  for (let i = 0; i < readings.length; i++) gauge.take(readings[i]!);
  total += gauge.most - gauge.least;
}

console.log(total);
