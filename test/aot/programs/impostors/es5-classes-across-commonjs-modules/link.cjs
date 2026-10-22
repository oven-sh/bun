exports.relink = function (Child, Parent) {
  Object.setPrototypeOf(Child.prototype, Parent.prototype);
};

exports.replace = function (Child, Parent) {
  var members = Child.prototype;
  Child.prototype = Object.create(Parent.prototype);
  for (var name in members) Child.prototype[name] = members[name];
  Child.prototype.constructor = Child;
};
