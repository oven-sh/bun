// resolve() takes the working directory without a call for as long as process.cwd is what it was.
const path = require("node:path");
const { cwd } = process;
function ask() {
  let answer;
  for (let i = 0; i < 50; i++) answer = path.resolve("x", "y");
  return answer.replace(cwd(), "real").replaceAll(path.sep, "/");
}
console.log(ask());
process.cwd = () => path.sep + "made";
console.log(ask());
process.cwd = cwd;
console.log(ask());
const before = path.resolve("x");
process.chdir("..");
console.log(ask(), path.relative(path.resolve("x"), before).replaceAll(path.sep, "/"));
