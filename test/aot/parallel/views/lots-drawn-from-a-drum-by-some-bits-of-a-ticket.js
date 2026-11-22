// STATISTIC: UnknownMaskKeysChecked >= 1
// Which lot of a drum a ticket draws goes by as many bits of the ticket as a number from outside says: such a key is asked itself, not the greatest that the ticket alone could be.
function loaded(drum, tickets, turn, limit) {
  var weight = 0;
  var at = 0;
  var blanks = 0;
  while (weight < limit && at < tickets.length) {
    var lot = drum[tickets[at] & turn];
    at += 1;
    if (lot === undefined) blanks += 1;
    else weight += lot;
  }
  return at + " tickets, " + blanks + " blanks, " + weight;
}
var drum = new Uint8Array(60).map(function (_, n) { return (n * 7) % 50; });
var tickets = Buffer.alloc(4000);
for (var n = 0; n < 4000; n++) tickets[n] = n * 37;
var turns = JSON.parse("[63, 31]");
for (var k = 0; k < turns.length; k++) console.log(loaded(drum, tickets, turns[k], 9000), loaded(drum, tickets, turns[k], 1e9));
