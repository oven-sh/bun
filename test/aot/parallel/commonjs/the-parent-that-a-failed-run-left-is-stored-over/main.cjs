let said = "none";
try {
    require("./first.cjs");
} catch (error) {
    said = error.message;
}
const kept = require("./kept.cjs");
console.log(said, typeof kept.parent);
kept.parent = null;
console.log(kept.parent === undefined, !kept.parent);
