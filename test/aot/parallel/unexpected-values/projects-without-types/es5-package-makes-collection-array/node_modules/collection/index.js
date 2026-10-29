function Collection() {
  this.length = 0;
  for (var i = 0; i < arguments.length; i++) this.push(arguments[i]);
}
Collection.prototype = Object.create(Array.prototype);
Collection.prototype.constructor = Collection;
Collection.prototype.first = function () {
  return this[0];
};

function Loud() {
  Collection.apply(this, arguments);
}
Loud.prototype = Object.create(Collection.prototype);
Loud.prototype.constructor = Loud;
Loud.prototype.push = function (item) {
  Array.prototype.push.call(this, String(item).toUpperCase());
  return "pushed loudly";
};
Loud.prototype.map = function () {
  return "mapped loudly";
};
Loud.prototype.indexOf = function () {
  return "zero";
};

function Stack() {
  var list = [];
  Object.setPrototypeOf(list, Stack.prototype);
  list.push.apply(list, arguments);
  return list;
}
Stack.prototype = Object.create(Array.prototype);
Stack.prototype.constructor = Stack;
Stack.prototype.pop = function () {
  return "popped " + Array.prototype.pop.call(this);
};

module.exports = { Collection: Collection, Loud: Loud, Stack: Stack };
