const hidden = value => { try { throw value; } catch (caught) { return caught; } };
class Ticket { static issued = 0; static issue() { return new Ticket(++Ticket.issued); } constructor(number) { this.number = number; } }
const one = hidden(Ticket.issue());
console.log(one.constructor.issue().number);
