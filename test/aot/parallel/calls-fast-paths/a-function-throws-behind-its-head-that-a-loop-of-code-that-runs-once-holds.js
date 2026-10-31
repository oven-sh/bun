// The loops hold a copy of what priceOf() does for a count that can be sold. For the one that cannot, they call it, and it throws what it always threw, at the turn where it always did.
// IR-UNTIL InlineHeads
// IR= 1 sellAll isAfterInlinedHead
function priceOf(record, rate) {
  if (record.count < 0) throw new RangeError("a count of " + record.count + " at a price of " + record.price + " and a rate of " + rate + " for " + record.name + " cannot be sold");
  return record.count * record.price * rate;
}
let turnsTaken = 0;
function sellAll(records, rate) { let total = 0; for (let n = 0; n < records.length; n++) { turnsTaken++; total += priceOf(records[n], rate); } return total; }
const records = [];
for (let n = 0; n < 50; n++) records.push({ name: "item " + n, count: n === 41 ? -3 : n, price: n / 4 });
try { console.log(sellAll(records, 2)); } catch (error) { console.log(error instanceof RangeError, error.message, turnsTaken); }

records[41].count = 41;
records[7].count = -1;
let sold = 0, turn = 0;
try { for (; turn < records.length; turn++) sold += priceOf(records[turn], 3); } catch (error) { console.log(error.message, sold, turn); }

records[7].count = 7;
sold = 0;
for (turn = 0; turn < records.length; turn++) sold += priceOf(records[turn], 3);
console.log(sold, turn);
