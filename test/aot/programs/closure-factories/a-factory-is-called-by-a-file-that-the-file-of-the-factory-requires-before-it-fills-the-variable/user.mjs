import { make } from "./helpers.mjs";
let first, second;
try {
  first = make(1);
  second = make("two");
} catch (error) {
  console.log(error.name);
}
setTimeout(() => console.log(typeof first, typeof second, first?.(), second?.()));
