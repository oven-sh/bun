// Regular expressions with a flag twice, an unknown flag, or both `u` and `v`, none of which is ever read: `bun run` reports them and runs nothing.
console.log("never printed");
var twice = /a/gg;
var unknown = /a/x;
var upperCase = /a/G;
var bothModes = /a/uv;
function neverCalled() {
  return /a/yiy;
}
