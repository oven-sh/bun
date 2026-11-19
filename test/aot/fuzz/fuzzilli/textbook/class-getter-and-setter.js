class Temperature {
  #celsius = 0;
  get fahrenheit() {
    return this.#celsius * 1.8 + 32;
  }
  set fahrenheit(value) {
    this.#celsius = (value - 32) / 1.8;
  }
  get celsius() {
    return Math.round(this.#celsius);
  }
}
const reading = new Temperature();
reading.fahrenheit = 212;
console.log(reading.celsius, reading.fahrenheit);
