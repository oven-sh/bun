// RUN: link
// CHECK: variable {{*}}name="g" {{*}}declared={type=anything

{
  function g() {}
}
module.exports.read = () => g;
