const hidden = value => { try { throw value; } catch (caught) { return caught; } };
function hand(step) { return hidden(step); }
function look(step) { return typeof step; }
const one = () => 1, two = () => 2, three = () => 3, four = () => 4;
console.log(hand(one)(), hand(two)(), look(three), look(four));
