// The program reaches the exports of node:url only through a field of an object that the compiler cannot follow, and reads the function under a key that it cannot follow. The store hands the module on as a value, so every member of it is compiled.
// Alone: what it prints depends on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
import * as url from "node:url";
const hide = value => new CustomEvent("x", { detail: value }).detail;
const box = hide({});
box.u = url;
try {
  console.log(box.u[hide("fileURLToPath")]("file:///a/b"));
} catch (error) {
  console.log(String(error.message).includes("was not compiled into this executable") ? "not compiled" : error.name);
}
