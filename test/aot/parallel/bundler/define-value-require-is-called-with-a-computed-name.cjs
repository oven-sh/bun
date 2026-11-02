// A call of a name whose `--define` value is `require` asks for a module that only the run names, as `__non_webpack_require__(name)` does in bundled packages: the executable loads it as where the text spells `require`.
// Flags: --define __non_webpack_require__=require
// Env: NAME_OF_MODULE=node:path
const path = require("node:path");
const loaded = __non_webpack_require__(process.env.NAME_OF_MODULE);
console.log(loaded === path, loaded.basename("/a/b.txt"));
