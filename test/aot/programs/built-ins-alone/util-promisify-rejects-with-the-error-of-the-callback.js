import { promisify } from "node:util";
function work(done) {
  done({ code: 1.5 });
}
try {
  await promisify(work)();
} catch (error) {
  console.log(error.code + 1);
}
