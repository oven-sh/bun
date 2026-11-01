class Options {
  get minimumFractionDigits() {
    return 3;
  }
}
console.log((1.5).toLocaleString("en", new Options()));
