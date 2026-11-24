// A method that a built-in calls keeps the object, and later code changes it.
let kept;
const list = [];
class Ticket {
  constructor(seat) {
    this.seat = seat;
    this.price = 1.5;
  }
  valueOf() {
    kept = this;
    return 12;
  }
  toString() {
    list.push(this);
    return "12";
  }
}

function move(seat) {
  if (kept) kept.seat = seat;
  for (const ticket of list) ticket.seat += seat;
}

function straight(ticket) {
  const before = ticket.seat;
  Number(ticket);
  move(9);
  return before + " " + ticket.seat;
}

function nested(ticket) {
  let total = 0;
  for (let turn = 0; turn < 3; turn++) {
    for (let side = 0; side < 2; side++) {
      if (turn === 1 && side === 1) {
        Math.max(1, ticket);
        move(40);
      }
      total += ticket.seat;
    }
  }
  return total + " " + ticket.seat;
}

function caught(ticket) {
  const before = ticket.seat + ticket.price;
  for (let turn = 0; turn < 3; turn++) {
    try {
      if (turn === 1) throw new Error("x");
    } catch {
      String(ticket);
      move(5);
    }
  }
  return before + " " + ticket.seat;
}

function asked(ticket) {
  return Reflect.get({ 12: 3 }, ticket);
}

function askedFirst(ticket) {
  const found = asked(ticket);
  move(6);
  return found + " " + ticket.seat;
}

console.log(straight(new Ticket(2)));
console.log(nested(new Ticket(3)));
console.log(caught(new Ticket(4)));
console.log(askedFirst(new Ticket(1)), list.length);
