function make(by) {
  return class Made {
    #step(x) {
      return x + by;
    }
    go(turns) {
      let sum = 0;
      for (let turn = 0; turn < turns; turn++) sum += this.#step(turn & 3);
      return sum;
    }
  };
}
const made = new (make(Number("1")))();
console.log(made[String("go")](Number(process.argv[2] ?? "1000")));
