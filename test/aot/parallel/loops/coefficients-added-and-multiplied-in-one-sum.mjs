// A coefficient is read as a 32-bit addend and as a factor in the same expression.
class Samples {
  constructor(values) {
    this.values = values;
  }

  measure(gain) {
    const fine = gain & 8191;
    const coarse = gain >> 13;
    const readings = [];
    for (let i = 0, size = this.values.length; i < size; i++) {
      const offset = this.values[i] & 8191;
      const level = this.values[i] >> 13;
      const middle = level * fine + offset * coarse;
      const bottom = (coarse | 0) + ((middle & 8191) << 13) + offset * fine;
      readings.push(coarse * level + (middle >> 13) + (bottom >> 26));
    }
    return readings;
  }
}

const sizes = (process.argv[2] ?? "3 1 5").split(" ").map(Number);
for (const gain of [2147483647, 2147221495, 2146959360, 1879228415, 1073741824, 268435456, 123456789]) {
  for (const size of sizes) {
    const samples = new Samples(Array.from({ length: size }, (_, i) => 67108863 - i));
    console.log(gain, samples.measure(gain).join(" "));
  }
}
