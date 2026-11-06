// A relative name of 100,000 letters is not found.
import { once } from "node:events";
const name = "./" + Buffer.alloc(100_000, "w").toString();
const said = (error: unknown) =>
  String((error as Error).message)
    .replace(name, "<name>")
    .replace(/\nRequire stack:[^]*$/, "")
    .replace(/ imported from .*$/, "")
    .replace(/ from '.*'$/, "");
try {
  require(name);
} catch (error) {
  console.log("require:", said(error));
}
try {
  await import(name);
} catch (error) {
  console.log("import:", said(error));
}
try {
  console.log("resolve:", import.meta.resolve(name).endsWith(name.slice(1)));
} catch (error) {
  console.log("resolve:", said(error));
}
const [event] = await once(new Worker(name), "error");
console.log("Worker:", said(event));
