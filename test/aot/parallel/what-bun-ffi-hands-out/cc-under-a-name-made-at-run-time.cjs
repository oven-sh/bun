// cc() is found under a name that the build cannot know. It refuses the operand before it asks for native code.
const ffi = require("bun:ffi");
const parts = JSON.parse('["c","c"]');
function pick(holder, name) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return holder[name];
}
try {
  pick(ffi, parts[0] + parts[1])(5);
} catch (error) {
  console.log(error.name, error.message);
}
