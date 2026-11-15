// import() converts a URL object to a string once, before it looks for a module. A conversion that throws rejects the promise.
const said = [];
const absent = ["node", "absent"].join(":");
const attempt = async (name, f) => {
  try {
    said.push(name + " " + (await f()).v);
  } catch (e) {
    said.push(name + " " + (e instanceof RangeError ? e.message : "refused"));
  }
};
const other = ["", new URL("./p/b.mjs", import.meta.url).href].join("");
{ const u = new URL("./p/" + "a.mjs", import.meta.url); await attempt("as made", () => import(u)); }
{ const u = new URL("./p/" + "b.mjs", import.meta.url); await attempt("the other", () => import(u)); }
{ const u = new URL("./p/" + "a.mjs", import.meta.url); u.toString = () => absent; await attempt("own toString", () => import(u)); }
{ const u = new URL("./p/" + "a.mjs", import.meta.url); u[Symbol.toPrimitive] = () => absent; await attempt("own toPrimitive", () => import(u)); }
{ const u = new URL("./p/" + "a.mjs", import.meta.url); u.toString = () => { throw new RangeError("thrown"); }; await attempt("throws", () => import(u)); }
{
  const u = new URL("./p/" + "a.mjs", import.meta.url);
  let when = "rejected";
  u.toString = () => { throw new RangeError("thrown"); };
  try {
    await import(u).catch(e => said.push("caught " + e.message));
  } catch {
    when = "thrown";
  }
  said.push(when);
}
{ const u = new URL("./p/" + "a.mjs", import.meta.url); Object.defineProperty(u, "href", { value: other }); await attempt("own href", () => import(u)); }
{ const u = new URL("./p/" + "a.mjs", import.meta.url); let n = 0; u.toString = () => { n++; return u.href; }; await attempt("counted", () => import(u)); said.push(n); }
{ const u = new URL("./p/" + "a.mjs", import.meta.url); let n = 0; u.toString = () => { n++; return absent; }; await attempt("counted, absent", () => import(u)); said.push(n); }
{ const u = new URL("./p/" + "a.mjs", import.meta.url); await attempt("href", () => import(u.href)); }
{ const u = new URL("./p/a.mjs", import.meta.url); u.toString = () => absent; await attempt("constant, own toString", () => import(u)); }
for (const line of said) console.log(line);
