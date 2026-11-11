let said = "none";
try {
    require("./first.cjs");
} catch (error) {
    said = error.message;
}
const kept = require("./kept.cjs");
module.parent = kept.parent;
console.log(said, module.parent === kept.parent);
