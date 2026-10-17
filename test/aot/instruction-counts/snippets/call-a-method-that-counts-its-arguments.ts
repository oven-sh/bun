// calls a method that looks at how many arguments it was given
class Settings {
  constructor(public value: number) {}
  entry(name: number, value?: number): number {
    if (name < 0) return process.argv.length;
    if (arguments.length === 1) return this.value + name;
    this.value = value as number;
    return name;
  }
}
const operations = 100;
const all: Settings[] = [];
for (let i = 0; i < operations; i++) all.push(new Settings(i));
let total = 0;

kernel: {
  let sum = 0;
  for (let i = 0; i < all.length; i++) sum += all[i].entry(i);
  total += sum;
}

console.log(total);
