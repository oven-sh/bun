// An executable answers as plain Bun does. Under --trim a name that is known only at run time does not count, so the first call throws:
// "atob and btoa was removed by --trim because your code never uses it by name." The report of the build names the site. `globalThis[name]()` keeps everything.
const names = (process.env.MADE_UP_NAMES ?? "atob,escape,parseInt").split(",");
addEventListener("a", event => {
  for (const name of names) console.log(`${name} ${typeof event.target[name]} ${event.target[name]("MTI=")}`);
});
EventTarget.prototype.dispatchEvent.call(undefined, new Event("a"));
