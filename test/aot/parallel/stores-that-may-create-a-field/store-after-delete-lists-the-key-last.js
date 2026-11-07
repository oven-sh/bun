function Ticket(seat) { this.seat = seat; this.row = 1; this.paid = false; }
function pay(ticket) { ticket.row = 2; ticket.paid = true; }
const out = [];
for (let i = 0; i < 6; i++) {
  const ticket = new Ticket(i);
  if (i % 3 === 1) delete ticket.row;
  if (i % 3 === 2) { delete ticket.paid; delete ticket.seat; }
  pay(ticket);
  out.push(Object.keys(ticket).join() + " " + JSON.stringify(ticket));
}
console.log(out.join("\n"));
