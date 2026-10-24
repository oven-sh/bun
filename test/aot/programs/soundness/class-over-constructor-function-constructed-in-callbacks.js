// A class over a constructor function: the super call allocates `this` for new.target. Constructed in callbacks of loops that test their array once in front of the loop.
function Legacy(value) {
  this.value = value;
}
Legacy.prototype.describe = function () {
  return this.constructor.name + ":" + this.value + ":" + this.next;
};
class Below extends Legacy {
  constructor(value) {
    super(value);
    this.next = value + 1;
  }
}
class Lowest extends Below {
  constructor(value) {
    super(value * 2);
  }
}
function each(array, callback) {
  for (let index = 0; index < array.length; index++) {
    if (index in array) callback(array[index], index, array);
  }
}
globalThis.each = each;

const made = [];
[1, 2].forEach(value => {
  made.push(new Below(value));
});
[3, 4].every(value => made.push(new Lowest(value)));
each([5, , 6], value => {
  made.push(new Below(value));
});
each([7], value => {
  made.push(new Legacy(value));
});
console.log(made.map(object => object.describe()).join(" "));
