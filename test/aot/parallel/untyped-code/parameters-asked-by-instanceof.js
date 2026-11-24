// A method asks its parameter by `instanceof` and is called with strings, instances, heirs and other objects.
class Ticket {
    constructor(seat, row) {
        this._row = row;
        this._seat = seat;
    }
    get seat() {
        return this._seat;
    }
    admits(guest) {
        const asked = guest instanceof Ticket ? guest.seat : guest;
        return asked === this.seat;
    }
    order(guest, isLate) {
        if (!(guest instanceof Ticket)) return isLate ? -1 : 1;
        return this._row - guest._row;
    }
}
class Pass extends Ticket {
    get seat() {
        return this._seat.toUpperCase();
    }
}
const key = JSON.parse('"hidden"');
const box = JSON.parse("{}");
function hide(value) {
    box[key] = value;
    return box[key];
}
const tickets = hide(["a", "b", "if", "\n", "a"].map((seat, row) => hide(seat === "if" ? new Pass(seat, row) : new Ticket(seat, row))));
class Gate {
    constructor(sold) {
        this.left = 0;
        this.sold = sold;
    }
    count(guest) {
        let admitted = 0;
        this.left = this.sold.length;
        while (this.left > 0) {
            const ticket = this.sold[this.sold.length - this.left];
            this.left--;
            if (ticket.admits(guest)) admitted++;
        }
        return admitted;
    }
}
const gate = new Gate(tickets);
const guests = ["a", "IF", "if", "\n", null, undefined, 3, new Ticket("a", 9), new Pass("if", 8), { _seat: "a", seat: "a" }, Object.create(Ticket.prototype), Object.create(new Ticket("b", 5)), new Proxy(new Ticket("a", 7), {})];
const say = word => console.log(word, guests.map(guest => gate.count(guest)).join(), guests.map(guest => tickets.map(ticket => ticket.order(guest, guest)).join(" ")).join());
say("as made");
Object.setPrototypeOf(tickets[0], Pass.prototype);
say("another prototype");
Object.defineProperty(Ticket, Symbol.hasInstance, { value: guest => typeof guest === "string", configurable: true });
console.log(tickets.map(ticket => {
    try {
        return ticket.admits("a");
    } catch (error) {
        return error.name;
    }
}).join());
