// Reflect.construct runs a constructor function for a class below it as new.target: the object inherits from the class and never went through its constructor, so the fields that constructor stores are missing.
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
const made = [new Below(1)];
made.push(Reflect.construct(Legacy, [8], Below));
console.log(made.map(object => object.describe()).join(" "));
console.log(made.map(object => "next" in object).join(" "), made.map(object => Object.keys(object).join()).join(" "));
