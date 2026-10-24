// `cond ? Object.assign({}, defaults, options) : defaults`: both sources are literals, so the copy stores under the names of the literals and what is read from the result is known.
const defaults = { depth: 2, width: 3, label: "plain" };
function settle(options) {
  return options ? Object.assign({}, defaults, options) : defaults;
}
function area(settings) {
  return settings.depth * settings.width + settings.label.length;
}
let total = 0;
for (let i = 0; i < 3000000; i++) total += area(settle(i & 1 ? { width: i & 7 } : undefined));
console.log(total, JSON.stringify(settle({ label: "other", extra: true })), JSON.stringify(defaults));
