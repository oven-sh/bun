// Another file creates a name on the exports object before the module's own first store: it comes first in the order of the keys.
console.log(Object.keys(require("./a.cjs")).join());
