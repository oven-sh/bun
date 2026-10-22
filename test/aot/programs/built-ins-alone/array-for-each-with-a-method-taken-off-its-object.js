class Sum {
  total = 0.5;
  add(value) {
    this.total += value;
  }
}
const sum = new Sum();
[1, 2].forEach(sum.add, sum);
console.log(sum.total + 1);
