// `new Message(i).retries` where only the prototype has the name: the object need not be made for the read, until something changes what the prototype answers.
const hide = Function("value", "return value");
class Message {
  id: number;
  declare retries: unknown;
  constructor(id: number) {
    this.id = id;
  }
}
Message.prototype.retries = 3;
function read(n: number): unknown {
  let last: unknown;
  for (let i = 0; i < n; i++) last = new Message(i).retries;
  return last;
}
const show = (value: unknown) =>
  typeof value === "function" ? "function" : String(value);
const log = (name: string) => console.log(name, show(read(3000)));
log("default");
Message.prototype.retries = 4;
log("second store");
Message.prototype.retries = "text";
log("text");
Message.prototype.retries = 1.5;
log("double");
Message.prototype.retries = undefined;
log("undefined");
delete Message.prototype.retries;
log("deleted");
Object.prototype.hasOwnProperty.call(Message.prototype, "retries");
Object.defineProperty(Message.prototype, "retries", {
  configurable: true,
  get(this: Message) {
    return "getter of " + this.id;
  },
});
log("getter");
delete Message.prototype.retries;
Object.getPrototypeOf(Message.prototype).constructor;
const original = Message.prototype;
const below = hide({ retries: "below" });
Object.setPrototypeOf(original, below);
log("on the chain");
Object.setPrototypeOf(original, Object.prototype);
(original as any).retries = 9;
log("back");
const shadow = Object.create(original);
shadow.retries = "shadow";
Object.setPrototypeOf(Message.prototype, null);
log("no Object.prototype");
Object.setPrototypeOf(Message.prototype, Object.prototype);
Message.prototype.retries = new Proxy({}, {});
console.log(typeof read(10));
Message.prototype.retries = 11;
function Old(this: any, id: number) {
  this.id = id;
}
Old.prototype.retries = 21;
function readOld(n: number) {
  let last: unknown;
  for (let i = 0; i < n; i++) last = new (Old as any)(i).retries;
  return last;
}
console.log(readOld(3000));
Old.prototype = { retries: 22 };
console.log(readOld(3000));
Old.prototype = hide(new Proxy({}, { get: (_, key) => "trap " + String(key) }));
console.log(readOld(10));
class Sub extends Message {}
function readSub(n: number) {
  let last: unknown;
  for (let i = 0; i < n; i++) last = new Sub(i).retries;
  return last;
}
console.log(show(readSub(3000)));
Sub.prototype.retries = 31;
console.log(show(readSub(3000)), show(read(10)));
