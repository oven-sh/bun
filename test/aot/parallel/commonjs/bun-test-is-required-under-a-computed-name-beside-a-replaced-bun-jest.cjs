const name = ["bun", "test"].join(":");
let calls = 0;
Bun.jest = () => {
  calls++;
  return "mine";
};
console.log(typeof require(name), calls);
