// Called without `new` they throw. A File is a Blob that has a name.
const classes = { CountQueuingStrategy, ByteLengthQueuingStrategy, DOMException, CustomEvent, ErrorEvent, MessageEvent, File };
function called(name) { try { return typeof classes[name](); } catch (error) { return error.name; } }
for (const name in classes) console.log(name, called(name));
function strategy() { return new CountQueuingStrategy({ highWaterMark: 3 }); }
console.log(strategy().highWaterMark, strategy().size(), typeof strategy().size);
function bytes() { return new ByteLengthQueuingStrategy({ highWaterMark: 3 }); }
console.log(bytes().highWaterMark, bytes().size(new Uint8Array(5)));
function failure() { return new DOMException("m", "AbortError"); }
console.log(failure().name, failure().message, failure().code, failure() instanceof Error, typeof failure().stack);
function custom() { return new CustomEvent("e", { detail: { a: 1 } }); }
console.log(custom().type, custom().detail.a, custom() instanceof Event, custom().bubbles);
function broken() { return new ErrorEvent("error", { message: "m", lineno: 3 }); }
console.log(broken().message, broken().lineno, broken().type);
function message() { return new MessageEvent("message", { data: [1], origin: "o" }); }
console.log(message().data[0], message().origin, message().ports.length);
function file() { return new File(["abc"], "n.txt", { type: "text/plain" }); }
console.log(file().name, file().size, file().type, await file().text(), file() instanceof Blob, file() instanceof File, typeof file().lastModified);
class Mine extends DOMException { extra = 1; }
console.log(new Mine("x").extra, new Mine("x") instanceof DOMException, new Mine("x").message);
