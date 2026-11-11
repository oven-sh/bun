const reading = {
  celsius: 20,
  get fahrenheit() {
    return this.celsius * 1.8 + 32;
  },
};
reading.celsius = 25;
console.log(reading.fahrenheit, Object.keys(reading).join(), JSON.stringify(reading));
