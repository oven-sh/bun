// A require that is made for a URL object which was changed behind its making looks from the folder that the URL names now.
// The build has bound the loads through it to the folder of this file, so compiled code refuses the call of createRequire() aloud (docs/compiler/compatibility.mdx).
// What this holds is that the file beside the program is never taken for the other.
import { createRequire } from "node:module";
import "./other/part.cjs";
import "./part.cjs";
const isChanged = process.argv.length < 9;
const elsewhere = pathname => pathname.replace("main.mjs", "other/start.cjs");
function report(way, load) {
  let said;
  try { said = load().said; } catch (error) { said = error.name; }
  console.log(way + ": the file beside the program is taken for it:", said === "beside main");
}
{
  const own = new URL(import.meta.url);
  if (isChanged) own.pathname = elsewhere(own.pathname);
  report("a store into a member", () => { const load = createRequire(own.href); return load("./part.cjs"); });
}
{
  const own = new URL(import.meta.url), other = own;
  if (isChanged) other.pathname = elsewhere(other.pathname);
  report("a store under another name", () => { const load = createRequire(own); return load("./part.cjs"); });
}
{
  const own = new URL(import.meta.url);
  const change = url => { if (isChanged) url.pathname = elsewhere(url.pathname); };
  change(own);
  report("a function that is handed the object", () => createRequire(own)("./part.cjs"));
}
