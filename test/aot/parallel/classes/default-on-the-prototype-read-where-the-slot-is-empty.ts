// Most objects leave the field to the default on the prototype. What the prototype answers changes while the loop's code stays.
class Message {
  id: number;
  declare retries: number;
  constructor(id: number) {
    this.id = id;
  }
}
Message.prototype.retries = 3;

class Urgent extends Message {}

function sum(n: number, make: (i: number) => Message): unknown {
  let s: any = 0;
  for (let i = 0; i < n; i++) {
    const message = make(i);
    if ((i & 255) === 0) message.retries = 5;
    s += message.retries;
  }
  return s;
}

const plain = (i: number) => new Message(i);
const urgent = (i: number) => new Urgent(i);
const show = (label: string) => console.log(label, sum(2000, plain), sum(2000, urgent));

show("at first");
Message.prototype.retries = 4;
show("another number");
(Message.prototype as any).retries = 0.5;
show("a fraction");
(Message.prototype as any).retries = "x";
console.log("a string", String(sum(4, plain)), String(sum(4, urgent)));
Message.prototype.retries = 2;
Urgent.prototype.retries = 7;
show("the class below answers first");
Object.defineProperty(Message.prototype, "retries", { get() { return this.id & 1; }, set(value) { Object.defineProperty(this, "retries", { value, writable: true, configurable: true, enumerable: true }); }, configurable: true });
show("an accessor");
delete (Message.prototype as any).retries;
console.log("deleted", String(sum(3, plain)), sum(3, urgent));
Message.prototype.retries = 3;
const one = new Message(1);
one.retries = 9;
delete (one as any).retries;
console.log("deleted from the object", one.retries, Object.keys(one).join());
(one as any).retries = undefined;
console.log("undefined of its own", one.retries, "retries" in one, Object.keys(one).join());
