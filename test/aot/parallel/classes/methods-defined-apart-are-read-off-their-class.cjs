"use strict";
// A member under a symbol or an index is defined as its class is evaluated, and so is each that stands behind it. Where one parcel has a field of the same name, the others still find the method of the class.
const stamp = Symbol("stamp");
const weight = Symbol.for("weight");

class Parcel {
    [stamp]() { return 1; }
    send() { return 2; }
    *walk() { yield 3; }
}
const first = new Parcel(), second = new Parcel();
second[stamp] = 4;
second.send = () => 5;
second.walk = function* () { yield 6; };
console.log(first[stamp] === Parcel.prototype[stamp], first.send === Parcel.prototype.send, first.walk === Parcel.prototype.walk);
console.log(first[stamp](), first.send(), [...first.walk()].join(), second[stamp], second.send(), [...second.walk()].join());
console.log(Object.getPrototypeOf(first.walk()) === Parcel.prototype.walk.prototype, first.walk() instanceof Parcel.prototype.walk);

class Tray {
    7() { return "seven"; }
    cost() { return 8; }
    get wide() { return 9; }
}
const trays = [new Tray(), new Tray()];
trays[1].cost = 10;
function same(count) {
    let found = 0;
    for (let place = 0; place < count; place++) {
        if (trays[place & 1].cost === Tray.prototype.cost)
            found++;
    }
    return found;
}
console.log(same(3), same(400), same(20000), trays[0].cost(), trays[1].cost, trays[0][7](), trays[0].wide);

class Ticket {
    [weight]() { return 11; }
    constructor(marked) {
        if (marked)
            this.price = 12;
    }
    price() { return 13; }
}
const tickets = [new Ticket(false), new Ticket(true)];
const known = new Map([[Ticket.prototype.price, "price"], [Ticket.prototype[weight], "weight"]]);
function nameOf(ticket) {
    return known.get(ticket.price) ?? "own";
}
console.log(nameOf(tickets[0]), nameOf(tickets[1]), known.get(tickets[0][weight]), tickets[0].price(), tickets[1].price);
tickets[0].price.calls = 14;
console.log(Ticket.prototype.price.calls);

function makeOnce(count) {
    class Stall {
        [stamp]() { return count; }
        open() { return count + 1; }
    }
    const one = new Stall(), other = new Stall();
    other[stamp] = 15;
    other.open = 16;
    const stalls = [one, other];
    let found = 0;
    for (let place = 0; place < count; place++)
        found += (stalls[place % 2][stamp] === Stall.prototype[stamp]) + 2 * (stalls[place % 2].open === Stall.prototype.open);
    return found;
}
console.log(makeOnce(5));

class Plain {
    open() { return 17; }
    shut() { return 18; }
}
const plain = [new Plain(), new Plain()];
plain[1].shut = 19;
console.log(plain[0].shut === Plain.prototype.shut, plain[0].open === Plain.prototype.open, plain[0].shut(), plain[1].shut);
