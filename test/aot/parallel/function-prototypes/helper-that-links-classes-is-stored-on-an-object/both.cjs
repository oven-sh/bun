var both = (module.exports = {});
both.inherits = function (ctor, superCtor) {
  ctor.prototype = Object.create(superCtor.prototype);
  ctor.prototype.constructor = ctor;
};
