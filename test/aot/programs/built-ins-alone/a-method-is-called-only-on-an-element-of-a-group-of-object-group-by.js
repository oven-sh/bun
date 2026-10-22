class Item {
  double() {
    return 3;
  }
}
const groups = Object.groupBy([new Item()], () => "all");
console.log(groups.all[0].double());
