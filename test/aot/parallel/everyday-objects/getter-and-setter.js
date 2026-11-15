// An accessor pair over one field, read and written in a loop
class Temperature {
  constructor(celsius) {
    this.celsius = celsius;
    this.writes = 0;
  }
  get fahrenheit() {
    return (this.celsius * 9) / 5 + 32;
  }
  set fahrenheit(value) {
    this.writes++;
    this.celsius = ((value - 32) * 5) / 9;
  }
}
function warm(celsius, steps) {
  const t = new Temperature(celsius);
  for (let i = 0; i < steps; i++) t.fahrenheit += 9;
  return t.celsius + " " + t.fahrenheit + " " + t.writes + " " + Object.keys(t);
}
console.log(warm(0, 1));
console.log(warm(100, 3));
console.log(warm(-40, 0));
