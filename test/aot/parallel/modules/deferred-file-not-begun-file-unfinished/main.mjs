// A deferred file is not begun while a file that it imports is unfinished.
import "./holder.mjs";
import "./owner.mjs";
console.log("main ends", globalThis.deferred.seen);
