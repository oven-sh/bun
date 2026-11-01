// Bun.jest converts a String object that is the path by calling its own toString.
let calls = 0;
const path = new String("/a.test.js");
path.toString = () => {
  calls++;
  return "/b.test.js";
};
console.log(typeof Bun.jest(path).expect, calls);
