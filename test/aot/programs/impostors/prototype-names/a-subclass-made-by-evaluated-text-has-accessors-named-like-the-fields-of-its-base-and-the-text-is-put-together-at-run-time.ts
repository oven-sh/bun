// The executable knows nothing of this subclass: its text is evaluated at run time. Its instances are built by the compiled constructor of the base,
// go through the compiled typed functions, and have a prototype with accessors named like the optional fields of the base.
// In this twin no text is a constant: it is put together at run time, so the build cannot read it and it runs interpreted.
function atRunTime(text: string): string {
  return JSON.parse(JSON.stringify(text.split(""))).join("");
}
class Message {
  declare id: number;
  declare body?: string;
  declare seen?: boolean;
  constructor(id: number, body?: string) {
    this.id = id;
    if (body !== undefined) this.body = body;
  }
}
function bodyOf(message: Message) {
  return message.body;
}
function setBody(message: Message, body: string) {
  message.body = body;
}
function markSeen(message: Message) {
  if (!message.seen) message.seen = true;
  return message.seen;
}
function state(message: Message) {
  return `${bodyOf(message)} ${message.seen} [${Object.keys(message)}]`;
}

let length = 0;
for (let i = 0; i < 3000; i++) {
  const message = new Message(i, i & 1 ? "text" : undefined);
  length += bodyOf(message)?.length ?? 1;
  if (i & 2) setBody(message, "other");
  if (i & 4) markSeen(message);
  length += state(message).length;
}
console.log("warm", length);

const log: string[] = [];
const Loud = new Function(
  "Base",
  "log",
  atRunTime(`return class Loud extends Base {
    get body() { return "loud " + this.id; }
    set body(value) { log.push("body = " + value + " on " + this.id); }
    get seen() { log.push("seen is asked"); return false; }
    set seen(value) { log.push("seen = " + value); }
  }`),
)(Message, log) as typeof Message;
const Quiet = new Function("Base", atRunTime("return class Quiet extends Base {}"))(Message) as typeof Message;

const loud = new Loud(1, "given to the constructor");
const quiet = new Quiet(2, "given to the constructor");
const plain = new Message(3, "given to the constructor");
console.log("made:", state(loud), "|", state(quiet), "|", state(plain), "|", log.join(", "));
log.length = 0;
for (const message of [loud, quiet, plain, new Loud(4), new Quiet(5), new Message(6)]) {
  setBody(message, "stored");
  const seen = markSeen(message);
  console.log(message.constructor.name, state(message), seen, "|", log.join(", "));
  log.length = 0;
}
(Quiet.prototype as any).seen = true;
const late = new Quiet(7);
console.log("the quiet one gets a value:", state(late), markSeen(late), state(late), "|", state(new Message(8)));
