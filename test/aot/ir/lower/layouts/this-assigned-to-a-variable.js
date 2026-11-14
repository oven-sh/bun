// RUN: link
// `t = Parent.call(this) || this; t.x = 1;`: a variable without a value that one assignment fills with `this` stands for `this`, and so does the assignment itself.
// CHECK: layout {{*}}name="Assigned" {{*}}key="own" declared={type=anything} flags=[IsRequired]}
// CHECK: layout {{*}}name="Sequence" {{*}}key="first" declared={type=anything} flags=[IsRequired]}, {key="a" declared={type=anything}}, {key="second" declared={type=anything} flags=[IsRequired]}
// CHECK: layout {{*}}name="Returned" {{*}}key="own" declared={type=anything}}

// RUN(NONE): link
// NONE-NOT: layout {{*}}name="AssignedTwice" {{*}}key="own"
// NONE-NOT: layout {{*}}name="SeenByEval" {{*}}key="own"

function Base(a) {
  this.a = a;
}
export function Assigned(a) {
  var self;
  self = Base.call(this, a) || this;
  self.own = 1;
  return self;
}
export function Sequence(a, b) {
  var self;
  return void 0 === b && (b = 2), ((self = Base.call(this, a) || this).first = b), (self.second = 3), self;
}
export function Returned(a) {
  var self;
  if (!a) return [];
  self = Base.call(this, a) || this;
  if (a > 1) return this;
  self.own = 1;
  return self;
}
export function AssignedTwice(a) {
  var self;
  self = Base.call(this, a) || this;
  self = { inner: a };
  self.own = 1;
  return this;
}
export function SeenByEval(a) {
  var self;
  self = Base.call(this, a) || this;
  eval("");
  self.own = 1;
  return self;
}
export const instances = [new Assigned(1), new Sequence(1), new Returned(1), new AssignedTwice(1), new SeenByEval(1)];
