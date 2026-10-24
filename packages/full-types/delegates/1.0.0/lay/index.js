
/**
 * Expose `Delegator`.
 */

module.exports = Delegator;

/**
 * Initialize a delegator.
 *
 * @param {Object} proto
 * @param {String} target
 * @api public
 */

function Delegator(this: DG.Delegator | void, proto: DG.Holder, target: string): DG.Delegator | void {
  if (!(this instanceof Delegator)) return new (Delegator as unknown as DG.Constructor)(proto, target);
  this.proto = proto;
  this.target = target;
  this.methods = [];
  this.getters = [];
  this.setters = [];
  this.fluents = [];
}

/**
 * Delegate method `name`.
 *
 * @param {String} name
 * @return {Delegator} self
 * @api public
 */

Delegator.prototype.method = function(this: DG.Delegator, name: string){
  var proto = this.proto;
  var target = this.target;
  this.methods.push(name);

  proto[name] = function(this: DG.Holder){
    return this[target][name].apply(this[target], arguments);
  };

  return this;
};

/**
 * Delegator accessor `name`.
 *
 * @param {String} name
 * @return {Delegator} self
 * @api public
 */

Delegator.prototype.access = function(this: DG.Delegator, name: string){
  return this.getter(name).setter(name);
};

/**
 * Delegator getter `name`.
 *
 * @param {String} name
 * @return {Delegator} self
 * @api public
 */

Delegator.prototype.getter = function(this: DG.Delegator, name: string){
  var proto = this.proto;
  var target = this.target;
  this.getters.push(name);

  proto.__defineGetter__(name, function(this: DG.Holder){
    return this[target][name];
  });

  return this;
};

/**
 * Delegator setter `name`.
 *
 * @param {String} name
 * @return {Delegator} self
 * @api public
 */

Delegator.prototype.setter = function(this: DG.Delegator, name: string){
  var proto = this.proto;
  var target = this.target;
  this.setters.push(name);

  proto.__defineSetter__(name, function(this: DG.Holder, val: unknown){
    return this[target][name] = val;
  });

  return this;
};

/**
 * Delegator fluent accessor
 *
 * @param {String} name
 * @return {Delegator} self
 * @api public
 */

Delegator.prototype.fluent = function (this: DG.Delegator, name: string) {
  var proto = this.proto;
  var target = this.target;
  this.fluents.push(name);

  proto[name] = function(this: DG.Holder, val: unknown){
    if ('undefined' != typeof val) {
      this[target][name] = val;
      return this;
    } else {
      return this[target][name];
    }
  };

  return this;
};

declare var require: (name: string) => any;
declare var module: { exports: any };
declare namespace DG {
  interface Holder { [name: string]: any }
  interface Delegator {
    proto: Holder; target: string; methods: string[]; getters: string[]; setters: string[]; fluents: string[];
    method(name: string): Delegator; access(name: string): Delegator; getter(name: string): Delegator; setter(name: string): Delegator; fluent(name: string): Delegator;
  }
  type Constructor = new (proto: Holder, target: string) => Delegator;
}
