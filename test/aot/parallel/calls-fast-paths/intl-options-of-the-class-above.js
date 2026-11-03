class Above {
  get minimumFractionDigits() {
    return 3;
  }
}
class Options extends Above {
  maximumFractionDigits = 4;
}
console.log(new Intl.NumberFormat("en", new Options()).format(1.5));
