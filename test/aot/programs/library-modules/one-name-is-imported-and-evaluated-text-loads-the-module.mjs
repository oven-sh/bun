// The rest of a module of which one name is imported, found by text that is evaluated at run time. The build does not see the text, so what the program itself never calls is not
// compiled: the text finds the module and its data, and a call of such a function is refused by name.
import { createServer } from "node:http";
const text = "return process.getBuiltinModule(\x27node:http\x27)";
try {
  const m = new Function(process.argv.length > 99 ? "" : text)();
  console.log(typeof m.request, m.METHODS.length > 10, typeof new m.ClientRequest("http://127.0.0.1:1/").on("error", () => {}).abort);
} catch (error) {
  console.log(error.name, error.message);
}
console.log(typeof createServer);
