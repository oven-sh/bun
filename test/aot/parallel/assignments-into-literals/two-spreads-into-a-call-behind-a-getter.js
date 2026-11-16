// STATISTIC: OwnKeyWalksExpanded >= 1
let options = { depth: 0, wide: false };
const defaults = { get depth() { options.wide = true; return 1; } };
function show(o) { return o.depth + "/" + o.wide; }
function run(first, start) { options = { depth: start, wide: false }; return show({ ...first, ...options }) + " " + show(Object.assign({}, first, options)) + " " + show({ wide: null, ...first, ...options }); }
for (const first of [{ depth: 5 }, defaults, { depth: 5 }]) console.log(run(first, 2));
