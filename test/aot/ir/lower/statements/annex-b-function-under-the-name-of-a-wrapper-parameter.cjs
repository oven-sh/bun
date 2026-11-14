// RUN: lower
// CHECK: function {{*}}kind=CommonJsModule
// CHECK: function {{*}}length=5
// CHECK-NEXT: b0([[this]]: anything, [[exports]]: anything,
// CHECK: PropSet [[exports]], {{*}}key="a"
// CHECK: = NewClosure
// CHECK: = TypeOf [[exports]]

// The five names are parameters of the function that holds the text of a CommonJS file, and no function in a block is copied over a parameter (Annex B.3.3.1): outside the block `exports` goes on meaning the parameter.
exports.a = 1;
{
  function exports() {}
  exports();
}
console.log(typeof exports);
