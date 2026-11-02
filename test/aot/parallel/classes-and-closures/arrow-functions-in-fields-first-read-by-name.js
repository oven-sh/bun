// Four classes give their objects arrow functions as fields under the same names. One function calls them on whatever it is handed, so it
// finds them by name, and every object is new: each call is the first read of its field.
// COUNT: operation:operationAOTReadField = 0
class Text {
  size = 1;
  send = more => this.size + more;
  other = () => "text";
}
class Json {
  extra = 0;
  size = 2;
  send = more => this.size * more;
  other = () => "json";
}
class Html {
  a = 0;
  b = 0;
  size = 3;
  send = async more => this.size - more;
  other = () => "html";
}
class Plain {
  size = 4;
  send(more) {
    return this.size + more + 1;
  }
  other() {
    return "plain";
  }
}

const classes = [Text, Json, Html, Plain];
function answer(object, more) {
  return object.send(more);
}
function both(object, more) {
  const send = object.send;
  return (object.send === send ? 0 : 1000) + object.other().length + (typeof send.call(object, more) === "number" ? 1 : 2);
}

let sum = 0;
for (let turn = 0; turn < 20000; turn++) {
  const result = answer(new classes[turn & 3](), turn & 15);
  sum += typeof result === "number" ? result : await result;
  sum += both(new classes[(turn >> 2) & 3](), turn & 7);
}
console.log(sum);

// Objects that have lived through collections, and names that are computed.
const old = [];
for (let index = 0; index < 4000; index++) old.push(new classes[index & 3]());
Bun.gc(true);
Bun.gc(true);
const names = ["send", "other"];
let later = 0;
for (let index = 0; index < old.length; index++) {
  const found = old[index][names[index & 1]];
  old[index].kept = found;
  const result = found.call(old[index], 2);
  later += typeof result === "string" ? result.length : typeof result === "number" ? result : 7;
}
Bun.gc(true);
for (let index = 0; index < old.length; index += 5) later += old[index].kept === old[index][names[index & 1]] ? 1 : 1000;
console.log(later);
