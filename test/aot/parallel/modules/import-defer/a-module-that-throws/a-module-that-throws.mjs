import defer * as t from "./throws.mjs";
console.log("main begins");
for (const time of [1, 2]) {
  try {
    console.log(t.never);
  } catch (error) {
    console.log("caught:", error.message);
  }
}
const held = t;
try {
  Object.keys(held);
} catch (error) {
  console.log("caught:", error.message);
}
