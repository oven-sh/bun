// The holder is written out with its elements, anew in each turn: what is stored over them in one turn is not there in the next.
const make = () => ({ 0: 1.5, 1: 2.5, 2: 3.5, length: 0 });
for (const item of JSON.parse('[10.5,"text",7]')) {
  const bag = make(), before = [bag[0], bag[1], bag[2]].join();
  Array.prototype.push.call(bag, item);
  Array.prototype.push.call(bag, item);
  console.log("SAID", before, bag[0], bag[1], bag[2], bag.length, Object.keys(bag).join());
}
