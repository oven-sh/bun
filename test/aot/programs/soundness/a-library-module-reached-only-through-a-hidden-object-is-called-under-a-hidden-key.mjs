// FAILS TODAY, and the .expected.txt pins how: plain Bun prints "/a/b". The program reaches the exports of node:url only through a field of an object that the compiler cannot follow, and reads the function under a key
// that it cannot follow: nothing tells the compiler that the function is used, so it is not in the executable, and the call says so. The day this is cured the test turns red: delete the .expected.txt.
import * as url from "node:url";
const hide = value => new CustomEvent("x", { detail: value }).detail;
const box = hide({});
box.u = url;
try {
  console.log(box.u[hide("fileURLToPath")]("file:///a/b"));
} catch (error) {
  console.log(String(error.message).includes("was not compiled into this executable") ? "not compiled" : error.name);
}
