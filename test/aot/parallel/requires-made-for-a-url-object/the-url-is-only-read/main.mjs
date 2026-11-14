import { createRequire } from "node:module";
function report(way, load) {
  let said;
  try { said = load().said; } catch (error) { said = error.code; }
  console.log(way + ":", said);
}
const note = value => typeof value;
{
  const own = new URL(import.meta.url), isOwn = own.pathname.endsWith("main.mjs");
  const load = createRequire(own);
  report("pathname is read, the object is given, " + isOwn, () => load("./part.cjs"));
}
{
  const own = new URL(import.meta.url), isOwn = own.pathname.endsWith("main.mjs");
  const load = createRequire(own.href);
  report("pathname is read, href is given, " + isOwn, () => load("./part.cjs"));
}
{
  const own = new URL(import.meta.url);
  if (own.protocol !== "file:") throw new Error("not a file");
  const load = createRequire(own);
  report("protocol is asked", () => load("./part.cjs"));
}
{
  const own = new URL(import.meta.url), text = `${own}`;
  const load = createRequire(own.href);
  report("it is written into a text, " + text.endsWith("main.mjs"), () => load("./part.cjs"));
}
{
  const own = new URL(import.meta.url), kind = note(own);
  const load = createRequire(own);
  report("a function of the program is handed it, " + kind, () => load("./part.cjs"));
}
{
  const own = new URL(import.meta.url);
  own.search = "";
  const load = createRequire(own);
  report("its query is emptied", () => load("./part.cjs"));
}
