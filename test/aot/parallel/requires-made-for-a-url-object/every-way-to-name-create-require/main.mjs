// However createRequire() is named, the value that it is given is asked whether it still names the folder of the file, where a call or a constructor made that value.
// Left alone: the load answers as ever. Moved to another folder: compiled code refuses the file aloud (docs/compiler/compatibility.mdx); the file beside the program is never taken for it.
import { createRequire } from "node:module";
import * as namespace from "node:module";
import whole from "node:module";
import "./part.cjs";
import "./other/part.cjs";
const isMoved = process.argv.length < 9;
const held = createRequire;
const required = createRequire(import.meta.url)("node:module");
function report(way, isLeftAlone, act) {
  let said;
  try { said = act(); } catch (error) { said = error.code ?? error.name; }
  console.log(way + (isLeftAlone ? ", left alone: " + said : ", moved: the file beside the program is taken for it: " + (said === "beside main")));
}
{
  const own = new URL(import.meta.url);
  report("an imported name", true, () => createRequire(own)("./part.cjs").said);
}
{
  const own = new URL(import.meta.url);
  if (isMoved) own.pathname = own.pathname.replace("main.mjs", "other/start.cjs");
  report("an imported name", false, () => createRequire(own)("./part.cjs").said);
}
{
  const own = new URL(import.meta.url);
  report("a namespace", true, () => namespace.createRequire(own)("./part.cjs").said);
}
{
  const own = new URL(import.meta.url);
  if (isMoved) own.pathname = own.pathname.replace("main.mjs", "other/start.cjs");
  report("a namespace", false, () => namespace.createRequire(own)("./part.cjs").said);
}
{
  const own = new URL(import.meta.url);
  report("the default export", true, () => whole.createRequire(own)("./part.cjs").said);
}
{
  const own = new URL(import.meta.url);
  if (isMoved) own.pathname = own.pathname.replace("main.mjs", "other/start.cjs");
  report("the default export", false, () => whole.createRequire(own)("./part.cjs").said);
}
{
  const own = new URL(import.meta.url);
  report("what require answers", true, () => required.createRequire(own)("./part.cjs").said);
}
{
  const own = new URL(import.meta.url);
  if (isMoved) own.pathname = own.pathname.replace("main.mjs", "other/start.cjs");
  report("what require answers", false, () => required.createRequire(own)("./part.cjs").said);
}
{
  const own = new URL(import.meta.url);
  report("process.getBuiltinModule", true, () => process.getBuiltinModule("node:module").createRequire(own)("./part.cjs").said);
}
{
  const own = new URL(import.meta.url);
  if (isMoved) own.pathname = own.pathname.replace("main.mjs", "other/start.cjs");
  report("process.getBuiltinModule", false, () => process.getBuiltinModule("node:module").createRequire(own)("./part.cjs").said);
}
{
  const own = new URL(import.meta.url);
  report("process.getBuiltinModule, held", true, () => { const load = process.getBuiltinModule("node:module").createRequire(own.href); return load("./part.cjs").said; });
}
{
  const own = new URL(import.meta.url);
  if (isMoved) own.pathname = own.pathname.replace("main.mjs", "other/start.cjs");
  report("process.getBuiltinModule, held", false, () => { const load = process.getBuiltinModule("node:module").createRequire(own.href); return load("./part.cjs").said; });
}
{
  const own = new URL(import.meta.url);
  report("a name that holds it", true, () => held(own)("./part.cjs").said);
}
{
  const own = new URL(import.meta.url);
  if (isMoved) own.pathname = own.pathname.replace("main.mjs", "other/start.cjs");
  report("a name that holds it", false, () => held(own)("./part.cjs").said);
}
{
  const own = new URL(import.meta.url);
  report("as a compiler writes it", true, () => (0, namespace.createRequire)(own)("./part.cjs").said);
}
{
  const own = new URL(import.meta.url);
  if (isMoved) own.pathname = own.pathname.replace("main.mjs", "other/start.cjs");
  report("as a compiler writes it", false, () => (0, namespace.createRequire)(own)("./part.cjs").said);
}
{
  const own = new URL(import.meta.url);
  report("by call", true, () => namespace.createRequire.call(void 0, own)("./part.cjs").said);
}
{
  const own = new URL(import.meta.url);
  if (isMoved) own.pathname = own.pathname.replace("main.mjs", "other/start.cjs");
  report("by call", false, () => namespace.createRequire.call(void 0, own)("./part.cjs").said);
}
