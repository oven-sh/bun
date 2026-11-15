// Static fields, methods and blocks, with a counter that a subclass shares
class Ticket {
  static next = 1;
  static made = [];
  static {
    this.start = this.next * 100;
  }
  static make(kind) {
    const ticket = new this(kind);
    Ticket.made.push(ticket.id);
    return ticket;
  }
  constructor(kind) {
    this.id = kind + (Ticket.start + Ticket.next++);
  }
}
class Season extends Ticket {
  static next = 50;
}
function buy(kind) {
  return [Ticket.make(kind).id, Season.make(kind).id, Ticket.next, Season.next, Season.made === Ticket.made, Ticket.made.length].join();
}
console.log(buy("a"));
console.log(buy("b"));
console.log(buy("c"));
