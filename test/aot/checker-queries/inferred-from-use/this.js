// `this` of a function that is neither a method of a class nor an arrow function is what the uses of `this` in it say.
// signature `Counter` = () this unwritten checked { count?: number; } returns unwritten checked void
function Counter() { this.count = 0; }
// signature `add` = (unwritten checked any) this unwritten checked { count?: any; } returns unwritten checked { count?: any; }
Counter.prototype.add = function add(n) { this.count += n; return this; };
// signature `Base` = (unwritten checked any) this unwritten checked { name?: any; } returns unwritten checked void
function Base(name) { this.name = name; }
// signature `Derived` = (unwritten checked any) this unwritten checked { extra?: number; name?: any; } returns unwritten checked void
function Derived(name) { Base.call(this, name); this.extra = 1; }
// signature `Applied` = () this unwritten checked { name?: any; } returns unwritten checked void
function Applied() { Base.apply(this, arguments); }
// signature `inArrow` = () this unwritten checked { items: any; seen: Function; } returns unwritten checked void
function inArrow() { this.items.forEach(item => this.seen(item)); }
// predicted `size` = number
function Sized(size) { Scaled.call(this, size); }
// predicted `size` = number
function Scaled(size) { this.size = size * 2; }
// The checker takes `this` in a method of an object literal to be the literal. That is where it is written, not a use.
const Mixin = {
  // signature `notify` = (unwritten checked any) this unwritten checked any returns unwritten checked never[]
  notify: function notify(value) { return this.listeners; },
  listeners: [],
};
