// The object that is the name of the event reaches the listeners of "removeListener", which write on it: what off() and removeAllListeners() were handed is read anew behind the call.
const said = [];
function listener() {}
process.on("removeListener", (name, gone) => {
  if (typeof name === "object") {
    name.heard++;
    said.push("object " + String(name) + " " + (gone === listener));
  } else said.push(typeof name + " " + String(name));
});
process.on("made-up", listener);
const name = {
  toString() {
    return "made-up";
  },
  heard: 0,
};
process.off(name, listener);
said.push("heard " + name.heard);
process.on("made-up", listener);
const other = {
  toString() {
    return "made-up";
  },
  heard: 0,
};
process.removeAllListeners(other);
said.push("heard " + other.heard);
console.log(said.join(" | "));
