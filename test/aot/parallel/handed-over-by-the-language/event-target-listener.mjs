const seen = [];
function listener(event, more) { seen.push("event:" + typeof event + (event === undefined ? "!" : "")); seen.push("more:" + typeof more + (more === undefined ? "!" : "")); }
listener(7, 8);
const t = new EventTarget();
t.addEventListener("x", listener);
t.dispatchEvent(new Event("x"));
console.log(seen.join(" "));
