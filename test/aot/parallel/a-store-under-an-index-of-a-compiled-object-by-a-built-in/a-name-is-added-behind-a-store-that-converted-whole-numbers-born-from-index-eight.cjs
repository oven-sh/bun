// One site adds a name to holders of one shape and learns the step. Then a fraction is stored over a whole number in such a holder: its storage is converted. The same site adds the name: the elements are read back as they are.
const make = () => { const bag = { length: 8 }; for (const item of JSON.parse("[1,2,3,4]")) Array.prototype.push.call(bag, item); return bag; };
const name = (bag, value) => { bag.added = value; };
const later = JSON.parse('["later","last"]');
const [fraction, text] = JSON.parse('[2.5,"text"]');
for (let turn = 0; turn < 9; turn++) {
  const bag = make();
  if (turn >= 3) { bag.length = 9; Array.prototype.push.call(bag, turn < 6 ? fraction : text); }
  name(bag, turn);
  for (const key of later) bag[key] = turn;
  Array.prototype.push.call(bag, turn + 0.25);
  console.log("SAID", turn, bag[8], bag[9], bag[10], bag[11], bag.length, JSON.stringify(bag), Object.keys(bag).join());
}
