// Todo: "object 0" | "string 1": a wrong answer today: under `bun build --compile --aot` it prints "object 0", for src/js/ahead-of-time/builtins/CommonJS.ts does not name Bun.jest, which would keep the test runner in every executable with a computed require(), where `bun <file>` prints "string 1"
const name = ["bun", "test"].join(":");
let calls = 0;
Bun.jest = () => {
  calls++;
  return "mine";
};
console.log(typeof require(name), calls);
