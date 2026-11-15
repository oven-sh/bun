// RUN: link
// CHECK: layout [[reader]] kind=Instance name="Reader"
// CHECK-LABEL: function {{*}}name="next"
// CHECK: thisType={type=[[reader]] flags=[IsExpected]}
// CHECK-LABEL: function {{*}}name="skip"
// CHECK: thisType={type=[[reader]] flags=[IsExpected]}
// CHECK-LABEL: function {{*}}name="shared"
// CHECK: thisType={type=anything}
// CHECK-LABEL: function {{*}}name="reset"
// CHECK: thisType={type=[[reader]] flags=[IsExpected]}
// CHECK-LABEL: function {{*}}name="reassigned"
// CHECK: thisType={type=anything}

// What a prototype object holds is called on what its constructor has made: a function written in the literal that becomes the prototype, one that the literal names, and one that is stored under a name later. A function that two prototypes hold may be called on either, and a binding that is written again is followed nowhere.
export function Reader(text) {
  this.text = text;
  this.at = 0;
}
Reader.prototype = {
  next: next,
  reset: function reset() {
    this.at = 0;
  },
  shared: shared,
  reassigned: changing,
};
Reader.prototype.skip = skip;

function next() {
  return this.text.charCodeAt(this.at++);
}
function skip() {
  this.at++;
}
export function Writer() {
  this.out = [];
  this.at = 0;
}
Writer.prototype.shared = shared;
function shared() {
  return this.at;
}
let changing = function reassigned() {
  return this.at;
};
export function change(to) {
  changing = to;
}
