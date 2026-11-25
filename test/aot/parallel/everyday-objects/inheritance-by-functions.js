// The same by functions, Object.create and calls of the other constructor
function Base(name) {
  this.name = name;
  Base.made++;
}
Base.made = 0;
Base.prototype.say = function (text) {
  return this.name + " says " + text;
};
function Derived(name, loud) {
  Base.call(this, name);
  this.loud = loud;
}
Derived.prototype = Object.create(Base.prototype);
Derived.prototype.constructor = Derived;
Derived.prototype.say = function (text) {
  const said = Base.prototype.say.call(this, text);
  return this.loud ? said.toUpperCase() : said;
};
function talk(name, text) {
  return [new Base(name), new Derived(name, true), new Derived(name, false)].map(one => one.say(text) + "/" + one.constructor.name).join(" ") + Base.made;
}
console.log(talk("a", "hi"));
console.log(talk("b", "yes"));
console.log(talk("c", ""));
