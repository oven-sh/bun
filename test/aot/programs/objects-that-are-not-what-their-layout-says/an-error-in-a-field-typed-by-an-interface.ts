// A field typed by an interface holds a literal, then an Error
interface HasMessage {
  message: string;
}
class Holder {
  held: HasMessage;
  constructor(held: HasMessage) {
    this.held = held;
  }
  tell(): string {
    return this.held.message + "|" + Error.isError(this.held) + "|" + (this.held instanceof Error);
  }
}
const holders = [new Holder({ message: "plain" }), new Holder(new Error("boom"))];
for (let round = 0; round < 3; round++) for (const h of holders) console.log(h.tell());
holders[0].held = new TypeError("late");
console.log(holders[0].tell());
