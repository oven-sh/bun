// A class that a function makes has fields in front of private ones that are null or undefined elsewhere. A helper hands a ticket back, and a body whose parameters are of any kind allocates it.
const office = (function () {
    class Ticket {
        row;
        seats = 2;
        #price = 10;
        constructor(row) { this.row = row; }
        static priceOf(ticket) { return ticket.#price; }
    }
    function print(row, seats) { return new Ticket(row, seats); }
    class Pass {
        since;
        isOpen = true;
        ratio = 0.5;
        #days = 1;
        constructor(since, extra) { this.since = since; }
        static daysOf(pass) { return pass.#days; }
    }
    function pass(since, extra) { return new Pass(since, extra); }
    class Badge {
        number;
        left = 3;
        #color = "red";
        right = 4;
        #size = 5;
        constructor(number, extra) { this.number = number; this.left = extra & 1 ? null : extra; }
        static tell(badge) { return [badge.#color, badge.#size]; }
    }
    function badge(number, extra) { return new Badge(number, extra); }
    return {
        sold(count) { let sum = 0, last; for (let place = 0; place < count; place++) { const ticket = print(place, 0); sum += ticket.row ? 1 : 2; ticket.seats = null; if (place === count - 1) last = ticket; } return [sum, last && [last.row, last.seats, Ticket.priceOf(last), Object.keys(last).join()]]; },
        kept(count) { const kept = []; for (let place = 0; place < count; place++) { const ticket = print(place, 1); if (ticket.row > 1) kept.push(ticket); } return kept.map(ticket => [ticket.row, ticket.seats, Ticket.priceOf(ticket)]); },
        passes(count) { let sum = 0, last; for (let place = 0; place < count; place++) { const one = pass(place, 0); sum += one.since ? 1 : 2; if (place & 1) { one.isOpen = undefined; one.ratio = null; last = one; } } return [sum, last && [last.since, last.isOpen === undefined, last.ratio, Pass.daysOf(last)]]; },
        badges(count) { let sum = 0, last; for (let place = 0; place < count; place++) { const one = badge(place, place & 3); sum += one.number ? 1 : 2; sum += one.left ?? 7; if (place === count - 1) last = one; } if (last) last.right = undefined; return [sum, last && [last.left, last.right === undefined, Badge.tell(last), Object.keys(last).join()]]; },
    };
})();
const held = JSON.parse("{}");
held["office" + process.pid] = office;
for (const count of [5, 1, 0, 20, "20", 3.5, "4"]) {
    const here = held["office" + process.pid];
    console.log(JSON.stringify([here.sold(count), here.kept(count), here.passes(count), here.badges(count)]));
}
