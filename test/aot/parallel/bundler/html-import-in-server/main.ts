// A server that imports a page: the page's scripts are bundled for the browser while the server itself is compiled, and both import one module.
// Reference: bun build --compile
import page from "./index.html";
import { greeting } from "./shared";

console.log(greeting("the server"));
const files: { path: string; loader: string }[] = (page as any).files ?? [];
console.log(files.map(file => file.loader).sort().join(" "));
for (const file of files) {
  if (file.loader !== "js") continue;
  const text = await Bun.file(file.path).text();
  console.log(text.includes("the browser"), text.includes("Hello from a module that both import"));
}
