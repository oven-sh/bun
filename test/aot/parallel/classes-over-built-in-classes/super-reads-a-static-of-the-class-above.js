// STATISTIC: ImageFunctionsEmitted <= 40
class List extends Array {
  static make() { return super.from([1, 2, 3]); }
}
console.log(List.make().length, List.make() instanceof List);
