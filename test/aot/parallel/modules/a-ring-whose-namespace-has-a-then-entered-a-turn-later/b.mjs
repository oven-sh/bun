import "./a.mjs";
console.log("b runs");
export function then(resolve) {
  console.log("then is called");
  resolve("what then gave");
}
