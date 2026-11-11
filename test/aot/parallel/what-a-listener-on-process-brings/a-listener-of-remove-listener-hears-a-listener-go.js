// A listener of "removeListener" runs inside off() and removeAllListeners(), and where a once() listener fires: what it counts is read anew behind each of them.
let heard = 0;
const said = [];
function listener() {}
process.on("removeListener", (name, gone) => {
  heard++;
  said.push(name + " " + (gone === listener));
});
process.on("made-up", listener);
let before = heard;
process.off("made-up", listener);
said.push(heard - before);
process.on("made-up", listener);
before = heard;
process.removeAllListeners("made-up");
said.push(heard - before);
process.once("made-up", listener);
before = heard;
process.emit("made-up");
said.push(heard - before);
console.log(said.join(" | "));
