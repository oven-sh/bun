// THE CONTROL: quiet under `bun run`, and here.
const add = EventTarget.prototype.addEventListener;
function heard() {}
console.log(add("x", heard));
