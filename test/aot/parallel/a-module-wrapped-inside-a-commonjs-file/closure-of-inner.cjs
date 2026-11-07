var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
const hooks = [];
var total;
var require_inner = __commonJS((exports, module) => {
  hooks.push(() => {
    let work = 0;
    for (let i = 0; i < 2; i++) work = (work + i) | 0;
    return typeof total + ":" + (total === undefined);
  });
  exports.done = 1;
});
require_inner();
for (const hook of hooks) console.log(hook());
total = process.argv.length + 40;
for (const hook of hooks) console.log(hook());
