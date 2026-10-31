// The global scope is an EventTarget. Taking a listener off it before anything was ever added to it does nothing. An executable once died here.
const listener = () => console.log("never called");
removeEventListener("nothing", listener);
globalThis.removeEventListener("nothing", listener);
self.removeEventListener("nothing", () => {});
const remove = removeEventListener;
remove("nothing", listener);
console.log("nothing was there to remove");
console.log(dispatchEvent(new Event("nothing")));
addEventListener("something", listener);
removeEventListener("something", listener);
console.log(dispatchEvent(new Event("something")));
