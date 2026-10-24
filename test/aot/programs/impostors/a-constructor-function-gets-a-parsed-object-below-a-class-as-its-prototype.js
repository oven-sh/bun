class Foo {}
function Bar() {}
const parent = JSON.parse("{}");
Object.setPrototypeOf(parent, Foo.prototype);
Bar.prototype = parent;
const bar = new Bar();
console.log(bar instanceof Foo);
