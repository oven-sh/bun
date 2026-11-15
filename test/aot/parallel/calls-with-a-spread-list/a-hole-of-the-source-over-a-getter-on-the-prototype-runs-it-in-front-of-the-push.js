// `list.push(a, ...other)`: a hole of the source reads on above it, where an accessor of the program stands on a prototype laid between the source and the built-in one: it runs in front of the push, sees the receiver as it was and may change it.
let said = "";
const watch = {};
function gather(source) { const out = ["w"]; watch.out = out; out.push("a", ...source); return out; }
const holed = () => [0, 1, 2, 3, 4, , 6];
const above = (source, deed) => Object.setPrototypeOf(source, Object.create(Array.prototype, { 5: { configurable: true, get() { said += "get, the receiver holds " + watch.out.length + ";"; deed(watch.out); return "above"; } } }));
console.log(JSON.stringify(gather(holed())));
console.log(JSON.stringify(gather(above(holed(), () => {}))), said);
console.log(JSON.stringify(gather(above(holed(), out => out.push("from the getter")))), said);
console.log(JSON.stringify(gather(above(holed(), out => { out.length = 0; }))), JSON.stringify(gather(holed())));
function inLoop(sources) { const out = []; watch.out = out; for (const source of sources) out.push("a", ...source); return JSON.stringify(out); }
console.log(inLoop([holed(), above(holed(), out => out.push("amid")), [1], above(holed(), () => {})]));
