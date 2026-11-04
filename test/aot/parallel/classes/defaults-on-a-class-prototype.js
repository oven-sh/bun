// A class keeps default values on its prototype object: read through instances before the default is there, while it is, and after it is stored again, hidden, made an accessor, frozen or deleted.
const lines = [];
function often(label, body) {
  const seen = new Set();
  for (let i = 0; i < 300; i++) seen.add(String(body(i)));
  lines.push(`${label}: ${[...seen].join(" ")}`);
}

class Message {
  constructor(id) {
    this.id = id;
  }
}
const retriesOf = message => message.retries;
const flagsOf = message => `${message.urgent},${message.sent},${message.reply}`;
const early = new Message(0);
often("before", () => retriesOf(early));
often("before, fresh", i => retriesOf(new Message(i)));
Message.prototype.retries = 3;
Message.prototype.urgent = false;
Message.prototype.sent = true;
Message.prototype.reply = null;
often("there", () => retriesOf(early));
often("there, fresh", i => retriesOf(new Message(i)));
often("there, others", i => flagsOf(new Message(i)));
often("there, has", i => "retries" in new Message(i));
often("there, own", i => Object.hasOwn(new Message(i), "retries"));
often("sum", i => {
  const message = new Message(i);
  if ((i & 63) === 0) message.retries = 5;
  return message.retries;
});
often("incremented", i => {
  const message = new Message(i);
  message.retries++;
  return `${message.retries},${Object.keys(message).join()}`;
});

class Urgent extends Message {}
class Patient extends Message {}
Patient.prototype.retries = 9;
often("below", i => retriesOf(i & 1 ? new Urgent(i) : new Patient(i)));

const hidden = new Message(1);
Object.defineProperty(hidden, "retries", { get: () => "own getter" });
often("hidden", i => retriesOf(i & 1 ? hidden : early));

Message.prototype.retries = 4;
often("stored again", i => retriesOf(new Message(i)));
often("stored again, below", i => retriesOf(new Urgent(i)));
Message.prototype.urgent = 0;
often("another type", i => flagsOf(new Message(i)));
Object.defineProperty(Message.prototype, "retries", { get: () => "getter", configurable: true });
often("an accessor", i => retriesOf(new Message(i)));
delete Message.prototype.retries;
often("deleted", i => retriesOf(new Message(i)));
often("deleted, below", i => retriesOf(i & 1 ? new Urgent(i) : new Patient(i)));

class Twice {}
Twice.prototype.level = 1;
Twice.prototype.level = 2;
often("two stores", () => new Twice().level);

class Either {}
Either.prototype.level = lines.length > 1000 ? 1 : 2;
often("no constant", () => new Either().level);

class ReadOnly {}
ReadOnly.prototype.level = 7;
Object.freeze(ReadOnly.prototype);
often("frozen", () => {
  const object = new ReadOnly();
  try {
    object.level = 8;
  } catch (error) {
    return `${error.constructor.name},${object.level}`;
  }
  return object.level;
});

class Relinked {}
Relinked.prototype.level = 1;
often("linked", () => new Relinked().level);
const relinked = new Relinked();
Object.setPrototypeOf(relinked, { level: "other prototype" });
often("an instance linked elsewhere", i => (i & 1 ? relinked : new Relinked()).level);

function make(level) {
  class Made {}
  Made.prototype.level = 5;
  if (level) Made.prototype.level = level;
  return Made;
}
const [First, Second] = [make(0), make(6)];
often("made twice", i => new (i & 1 ? First : Second)().level);

console.log(lines.join("\n"));
