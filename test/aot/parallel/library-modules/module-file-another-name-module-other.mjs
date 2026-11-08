// The frames of errors that pass through "@vercel/fetch", and what answers to that name.
import make from "@vercel/fetch";
const places = error =>
  String(error.stack)
    .split("\n")
    .slice(1, 3)
    .map(line => line.trim().replace(/\(?[^ (]*[\\/]([^\\/ ]+:\d+:\d+)\)?/, "$1"))
    .join(" < ");
const call = make(() => {
  throw new Error("from the wrapper");
});
await call("u").catch(error => console.log(places(error)));
await call("u", null).catch(error => console.log(places(error)));
Error.prepareStackTrace = (error, sites) => [sites[0].getFunctionName(), sites[0].getFileName(), sites[0].getScriptNameOrSourceURL()].join(" ");
await call("u", null).catch(error => console.log(error.stack));
const made = text => text.split("").join("");
console.log((await import(made("@vercel/fetch"))).default === make, require(made("@vercel/fetch")) === make);
console.log(import.meta.resolve("@vercel/fetch"), require.resolve("@vercel/fetch"), import.meta.resolve(made("@vercel/fetch")));
