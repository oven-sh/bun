// util.inherits and Function.prototype.call constructors, three levels, super calls by name, toString and valueOf
'use strict';
var util = require('util');
function Base(name) { this.name = name; this.children = []; this.parent = null; Base.made = (Base.made || 0) + 1; }
Base.prototype.add = function (c) { c.parent = this; this.children.push(c); return this; };
Base.prototype.size = function () { var n = 1; this.children.forEach(function (c) { n += c.size(); }); return n; };
Base.prototype.path = function () { return (this.parent ? this.parent.path() + '/' : '') + this.name; };
Base.prototype.toString = function () { return '[' + this.constructor.name + ' ' + this.name + ']'; };
Base.prototype.visit = function (fn, depth) { depth = depth || 0; fn(this, depth); for (var i = 0; i < this.children.length; i++) this.children[i].visit(fn, depth + 1); };
Base.create = function (name) { return new this(name); };
function Folder(name) { Base.call(this, name); this.open = true; }
util.inherits(Folder, Base); Folder.create = Base.create;
Folder.prototype.size = function () { return Base.prototype.size.call(this) + (this.open ? 0 : 100); };
Folder.prototype.find = function (re) { var out = []; this.visit(function (n) { var m = re.exec(n.name); if (m) out.push(n.path() + (m[1] ? '(' + m[1] + ')' : '')); }); return out; };
function Leaf(name, bytes) { Base.call(this, name); this.bytes = bytes; }
util.inherits(Leaf, Base);
Leaf.prototype.add = function () { throw new TypeError(this + ' takes no children'); };
Leaf.prototype.size = function () { return this.bytes === undefined ? Leaf.super_.prototype.size.apply(this, arguments) : this.bytes; };
Leaf.prototype.valueOf = function () { return this.bytes; };
function Link(name, target) { Leaf.call(this, name); Object.defineProperty(this, 'target', { get: function () { return target; }, enumerable: false }); }
util.inherits(Link, Leaf);
Link.prototype.size = function () { return this.target ? this.target.size() + 0.5 : 0; };
Link.prototype.path = function () { return Link.super_.prototype.path.call(this) + ' -> ' + (this.target ? this.target.name : 'nothing'); };
module.exports = { Base: Base, Folder: Folder, Leaf: Leaf, Link: Link };
