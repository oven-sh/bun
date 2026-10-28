// The name of a property is held in 16 bits though its characters fit in 8. The same characters are then put together out of texts held in 8 bits, three times in each way, and name the property.
const held = text => Buffer.from(text, "utf16le").toString("utf16le");
const narrow = text => Buffer.from(text, "latin1").toString("latin1");

function copy(source) {
  let value = "";
  for (let at = 0; at < source.length; at++) value += String.fromCharCode(source.charCodeAt(at));
  return value;
}
function readUnderTwoParts(object, first, second) {
  return object[first + second];
}
function readUnderThreeParts(object, first, second, third) {
  return object[first + second + third];
}

const ways = {
  "character by character": (holder, name) => holder[copy(name)],
  "two parts": (holder, name, turn) => readUnderTwoParts(holder, narrow(name.slice(0, turn + 1)), narrow(name.slice(turn + 1))),
  "three parts": (holder, name, turn) => readUnderThreeParts(holder, narrow(name.slice(0, 1)), narrow(name.slice(1, turn + 2)), narrow(name.slice(turn + 2))),
  "in small letters": (holder, name) => holder[narrow(name.toUpperCase()).toLowerCase()],
  "a template": (holder, name, turn) => holder[`${narrow(name.slice(0, turn + 1))}${narrow(name.slice(turn + 1))}`],
};
for (const [way, read] of Object.entries(ways)) {
  for (const rest of ["abcd", "éàbcd", "a name of many words", "abcdefgh".repeat(6)]) {
    const name = narrow(way.slice(0, 2) + rest);
    const holder = { [held(name)]: "found" };
    const found = [];
    for (let turn = 0; turn < 3; turn++) found.push(read(holder, name, turn));
    console.log(way, name.length, found.join(" "), Object.keys(holder)[0] === name);
  }
}
