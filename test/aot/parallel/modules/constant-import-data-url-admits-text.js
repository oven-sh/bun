// A data: URL that is imported under a constant name is text of the program, and it runs. It admits no other text: a URL that is put together at run time, a blob: URL
// and require() of either are refused behind it as they are before it.
// Alone: what is refused depends on what else the executable holds: a package left outside of it admits every file
const glue = (...parts) => parts.join("");
const attempt = async (what, load) => {
  try {
    console.log(what + ":", (await load()).default);
  } catch (error) {
    console.log(what + ": refused", error.code);
  }
};
const madeAtRunTime = () => glue("data:text/java", "script,export default 'made at run time'");
await attempt("a URL made at run time, first", () => import(madeAtRunTime()));
await attempt("a constant URL", () => import("data:text/javascript,export default 'constant'"));
await attempt(
  "the same URL, made at run time",
  () => import(glue("data:text/java", "script,export default 'constant'")),
);
await attempt("a URL made at run time", () => import(madeAtRunTime()));
await attempt(
  "a blob: URL",
  () => import(URL.createObjectURL(new Blob(["export default 'blob'"], { type: "text/javascript" }))),
);
await attempt("require() of a URL made at run time", () => require(madeAtRunTime()));
await attempt(
  "a constant URL whose text loads built-in modules",
  () =>
    import(
      'data:text/javascript,import { sep } from "node:path"; const os = await import("node:os"); export default [typeof sep, typeof os.EOL, typeof require("node:util").inspect].join()'
    ),
);
await attempt("a URL made at run time, last", () => import(madeAtRunTime()));
{
  const btoa = text => text;
  await attempt(
    "a URL from a function of the program with the name of an encoder",
    () => import("data:text/javascript;base64," + btoa("ZXhwb3J0IGRlZmF1bHQgMQ==")),
  );
  await attempt(
    "what the encoder of that name makes of the same text",
    () => import(glue("data:text/javascript;base64,", globalThis.btoa("ZXhwb3J0IGRlZmF1bHQgMQ=="))),
  );
}
/* Output:
a URL made at run time, first: refused ERR_MODULE_NOT_FOUND
a constant URL: constant
the same URL, made at run time: constant
a URL made at run time: refused ERR_MODULE_NOT_FOUND
a blob: URL: refused ERR_MODULE_NOT_FOUND
require() of a URL made at run time: refused MODULE_NOT_FOUND
a constant URL whose text loads built-in modules: string,string,function
a URL made at run time, last: refused ERR_MODULE_NOT_FOUND
a URL from a function of the program with the name of an encoder: refused ERR_MODULE_NOT_FOUND
what the encoder of that name makes of the same text: refused ERR_MODULE_NOT_FOUND
*/
