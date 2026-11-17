function first() { return "first ran"; }
function change(descriptor) { descriptor.get = function () { return this; }; }
const entry = { get: () => 1 };
change(entry);
Object.defineProperties(first, { limit: entry });
const same = first.limit;
console.log(same());
