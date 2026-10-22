import { promisify } from "node:util";
function work(first, second, done) {
  console.log(typeof first, typeof second, typeof done, arguments.length);
  done(null, { sum: first + second });
}
console.log((await promisify(work)(1.5, 2)).sum + 1);
