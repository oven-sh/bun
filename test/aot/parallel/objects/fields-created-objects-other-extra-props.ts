// A store that finds the slot of a field empty creates the property, and a read that finds it empty answers undefined, only where the property lies nowhere else on the object.
// That is so as long as no FIELD of the object has left its slot. A name that the layout has no field for, stored in between, changes nothing about the fields: the order of keys still has it in its place.
// A field that has left its slot (a value its slot cannot hold, an accessor, a property that is read-only) is found where it lies, by the same compiled stores and reads.
interface Message {
  socket?: string;
  complete?: boolean;
  url?: string;
  count?: number;
  trailers?: string[];
}

class Made {}
interface Made extends Message {}

const hand = new Function("value", "return value") as <T>(value: T) => T;
const odd = hand("odd" + "Name");
const mark = hand(Symbol("mark"));

function fillHead(message: Message, socket: string) {
  message.socket = socket;
  message.complete = false;
}
function fillTail(message: Message, url: string, count: number) {
  message.url = url;
  message.count = count;
  message.trailers = [url];
}
function read(message: Message) {
  return [message.socket, message.complete, message.url, message.count, message.trailers?.length, "url" in message, Object.hasOwn(message, "count")].join();
}
function show(label: string, message: Message) {
  const listed: string[] = [];
  for (const name in message) listed.push(name);
  console.log(label, "|", read(message), "|", Object.keys(message).join(), "|", listed.join(), "|", Reflect.ownKeys(message).length, "|", JSON.stringify(message));
}

function plain() {
  const message = hand(new Made());
  fillHead(message, "s");
  fillTail(message, "/plain", 1);
  return message;
}
function withExtraInBetween() {
  const message: any = hand(new Made());
  fillHead(message, "s");
  message[odd] = "extra";
  message[mark] = 1;
  fillTail(message, "/extra", 2);
  return message as Message;
}
function withExtraFirst() {
  const message: any = hand(new Made());
  message[odd] = "first";
  fillHead(message, "s");
  fillTail(message, "/first", 3);
  delete message[odd];
  return message as Message;
}
function withOtherTypeInField() {
  const message: any = hand(new Made());
  fillHead(message, "s");
  message.url = { not: "a string" };
  message.count = "seven";
  show("other types before the stores", message);
  fillTail(message, "/typed", 4);
  return message as Message;
}
function withAccessor() {
  const message: any = hand(new Made());
  const seen: unknown[] = [];
  Object.defineProperty(message, "url", { get: () => "from the getter", set: value => void seen.push(value), enumerable: true, configurable: true });
  fillHead(message, "s");
  fillTail(message, "/accessor", 5);
  console.log("the setter saw", seen.join());
  return message as Message;
}
function withReadOnly() {
  const message: any = hand(new Made());
  Object.defineProperty(message, "count", { value: -1, writable: false, enumerable: true, configurable: true });
  fillHead(message, "s");
  let thrown = "nothing";
  try {
    fillTail(message, "/read-only", 6);
  } catch (error) {
    thrown = (error as Error).constructor.name;
  }
  console.log("the store threw", thrown);
  return message as Message;
}
function withDeletedField() {
  const message: any = hand(new Made());
  fillHead(message, "s");
  fillTail(message, "/deleted", 7);
  delete message.url;
  message[odd] = "after the deletion";
  show("deleted", message);
  message.url = 8;
  show("another type after the deletion", message);
  fillTail(message, "/again", 9);
  return message as Message;
}

for (let round = 0; round < 3; round++) {
  show("plain", plain());
  show("extra in between", withExtraInBetween());
  show("extra first", withExtraFirst());
  show("other types", withOtherTypeInField());
  show("accessor", withAccessor());
  show("read-only", withReadOnly());
  show("deleted", withDeletedField());
}

let sum = 0;
for (let index = 0; index < 30000; index++) {
  const message = index % 3 ? withExtraInBetween() : plain();
  if (index % 1000 === 0) (message as any).count = "text";
  sum += typeof message.count === "number" ? message.count : 100;
  sum += Object.keys(message).length + (message.trailers?.length ?? 0);
}
console.log(sum);
