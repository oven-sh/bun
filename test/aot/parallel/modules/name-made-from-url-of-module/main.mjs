// The name of a file is made with `new URL(.., import.meta.url)`, and a part of it is known only when the program runs.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const chosen = process.argv[2] ?? "two";
const show = async (what, loaded) => console.log(what + ":", (await loaded).label);

await show("a constant", import(new URL("./parts/one.mjs", import.meta.url)));
await show("the href of a constant", import(new URL("./parts/one.mjs", import.meta.url).href));
await show("a URL", import(new URL("./parts/" + chosen + ".mjs", import.meta.url)));
await show("href", import(new URL("./parts/" + chosen + ".mjs", import.meta.url).href));
await show("toString()", import(new URL(`./parts/${chosen}.mjs`, import.meta.url).toString()));
await show("toJSON()", import(new URL(`./parts/${chosen}.mjs`, import.meta.url).toJSON()));
await show("nothing in front", import(new URL(`parts/${chosen}.mjs`, import.meta.url)));
await show("out of a folder and back", import(new URL(`./parts/../parts/${chosen}.mjs`, import.meta.url)));
await show("pathname", import(new URL(`./parts/${chosen}.mjs`, import.meta.url).pathname));
await show("fileURLToPath()", import(fileURLToPath(new URL(`./parts/${chosen}.mjs`, import.meta.url))));
await show("pathToFileURL()", import(pathToFileURL(path.join(import.meta.dirname, "parts", chosen + ".mjs"))));
await show(
  "the href of pathToFileURL()",
  import(pathToFileURL(path.join(import.meta.dirname, "parts", chosen + ".mjs")).href),
);

const held = new URL(`./parts/${chosen}.mjs`, import.meta.url);
await show("String()", import(String(held)));
await show("a template", import(`${held}`));
await show("a sum", import(held + ""));
await show("a URL of a URL", import(new URL(held)));

const table = { one: new URL("./parts/one.mjs", import.meta.url), two: new URL("./parts/two.mjs", import.meta.url) };
await show("a table", import(table[chosen]));
const locate = name => new URL(`./parts/${name}.mjs`, import.meta.url);
await show("a function", import(locate(chosen)));
for (const name of ["one", "two"]) await show("a list", import(new URL(`./parts/${name}.mjs`, import.meta.url)));

const require = createRequire(import.meta.url);
console.log("require:", require(fileURLToPath(new URL(`./parts/${chosen}.cjs`, import.meta.url))).label);

const failure = await import(new URL(`./parts/${chosen}-is-not-there.mjs`, import.meta.url)).catch(error => error);
console.log("a file that is not there:", failure.name, failure.code);
