// A function that hands its `this` to another function stores what that function stores, at the place of the call.
function Base(name) {
  this.name = name;
  this.ready = false;
}
function Middle(name) {
  this.before = 1;
  Base.call(this, name);
  this.after = 2;
}
function Leaf(name) {
  Middle.apply(this, [name]);
  this.ready = true;
  this.own = 3;
}
function Both() {
  this.own = 1;
  Base.call(this, "both");
  Middle.call(this, "both");
}
function OtherReceiver(other) {
  this.own = 1;
  Base.call(other, "other");
}
function InAnArrowFunction() {
  this.own = 1;
  const start = () => Base.call(this, "arrow");
  start();
}
function InAnInnerFunction() {
  this.own = 1;
  function start() {
    Base.call(this, "inner");
  }
  start();
}
function First() {
  this.first = 1;
  Second.call(this);
}
function Second() {
  this.second = 2;
  First.call(this);
}
let Reassigned = function () {
  this.lost = 1;
};
Reassigned = function () {
  this.lost = 2;
};
function CallsReassigned() {
  this.own = 1;
  Reassigned.call(this);
}
function InRemovedCode() {
  this.own = 1;
  if (false) Base.call(this, "removed");
}
function BehindASpread(list) {
  this.own = 1;
  Base.call(...list, this);
}
function OtherMember() {
  this.own = 1;
  Base.bind(this, "bound");
}
new Base(), new Middle(), new Leaf(), new Both(), new OtherReceiver(), new InAnArrowFunction(), new InAnInnerFunction(), new First(), new Second();
new CallsReassigned(), new InRemovedCode(), new BehindASpread(), new OtherMember();
