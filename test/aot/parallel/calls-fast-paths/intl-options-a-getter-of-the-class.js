class Options {
  get minimumFractionDigits() {
    return 3;
  }
}
console.log(new Intl.NumberFormat("en", new Options()).format(1.5));
