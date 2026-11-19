// Fields of a class that are first stored outside the constructor, by stores in line, on objects that got 0 to 4 properties which the class does not list: the keys stand in the order of their creation, at every turn
class Message {
  constructor(id) {
    this.id = id;
    this.url = "/";
  }
}
class Reply {
  constructor(id) {
    this.id = id;
  }
}
function finish(message, at) {
  message.complete = true;
  message.endedAt = at;
}
function finishBackward(message, at) {
  message.endedAt = at;
  message.complete = false;
}
function finishOne(message) {
  message.complete = null;
}
function send(reply, body) {
  reply.sent = true;
  reply.body = body;
  reply.length = body.length;
}
const mark = Symbol("mark");
const lists = [
  ["res", "next", "baseUrl", "route"],
  [mark, "res", Symbol.for("shared"), "next"],
  ["10", "res", "2", "next"],
  ["complete2", "endedAt2", "id2", "url2"],
];
const seen = new Map();
const lines = [];
function tell(label, object) {
  const said = Reflect.ownKeys(object).map(String).join() + " | " + Object.keys(object).join() + " | " + JSON.stringify(object);
  let inLoop = "";
  for (const key in object) inLoop += key + ",";
  const whole = said.replace(/\d+(?=[,}])/g, "n") + " | " + inLoop;
  const before = seen.get(label);
  if (before === undefined) {
    seen.set(label, whole);
    lines.push(label + ": " + whole);
  } else if (before !== whole) lines.push("LATER " + label + ": " + whole);
}
for (let turn = 0; turn < 60; turn++) {
  for (let list = 0; list < lists.length; list++) {
    for (let count = 0; count <= 4; count++) {
      const extra = (turn + count) % 5;
      const first = new Message(turn);
      for (let index = 0; index < extra; index++) first[lists[list][index]] = index;
      finish(first, turn);
      tell(`forward ${list} ${extra}`, first);

      const second = new Message(turn);
      for (let index = 0; index < extra; index++) second[lists[list][index]] = index;
      finishBackward(second, turn);
      tell(`backward ${list} ${extra}`, second);

      const third = new Message(turn);
      finishOne(third);
      for (let index = 0; index < extra; index++) third[lists[list][index]] = index;
      third.endedAt = turn;
      tell(`between ${list} ${extra}`, third);

      const fourth = new Reply(turn);
      for (let index = 0; index < extra; index++) fourth[lists[list][index]] = index;
      send(fourth, "body");
      tell(`reply ${list} ${extra}`, fourth);

      const fifth = new Reply(turn);
      for (let index = 0; index < extra; index++) fifth[lists[list][index]] = index;
      fifth.body = "early";
      if (extra) delete fifth[lists[list][0]];
      send(fifth, "late");
      tell(`deleted ${list} ${extra}`, fifth);
    }
  }
}
console.log(lines.length, lines.filter(line => line.startsWith("LATER")).length);
console.log(lines.join("\n"));
