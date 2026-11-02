// RUN: lower
// CHECK: function {{*}}kind=Arrow {{*}}captures=[{type=anything

{
  function g() {}
}
module.exports.read = () => g;
