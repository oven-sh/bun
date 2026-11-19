function heavy() {
  return require("./heavy.cjs");
}
console.log("start");
console.log(heavy().work(3), heavy() === heavy());
