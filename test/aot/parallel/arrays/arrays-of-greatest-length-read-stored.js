// A store under the last index that an array can have gives the array the greatest length there is.
function receivers() { return [[10, 11, 12, 13], ["a", {}, null, undefined, 4], [1, , 3], []]; }
function read(object, x) { return object[Math.floor(x)]; }
function store(object, x, value) { object[Math.floor(x)] = value; }
for (let turn = 0; turn < 3; turn++) {
  const list = receivers();
  for (let r = 0; r < list.length; r++) {
    store(list[r], 4294967294, turn);
    console.log("stored", r, list[r].length, read(list[r], 0), read(list[r], 4294967293), read(list[r], 4294967294));
  }
}
