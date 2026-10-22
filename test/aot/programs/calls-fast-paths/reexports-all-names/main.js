// A CommonJS module that binds every name of another module to its own exports keeps them in variables where the other does: a name is read without a property access. The two functions that do it are known by what they do: as TypeScript writes them, as it wrote them earlier, by hand under other names.
// IR- PropGet v[0-9]+ name="(add|limit|sum|top|product|bottom)"
// IR- CallMethod v[0-9]+ \(.*\) name="(add|sum|product)"
// IR- ^ .*ForInKeys
const written = require("./files/written.js");
console.log(written.add(), written.limit);
const written_earlier = require("./files/written-earlier.js");
console.log(written_earlier.sum(), written_earlier.top);
const by_hand = require("./files/by-hand.js");
console.log(by_hand.product(), by_hand.bottom);
