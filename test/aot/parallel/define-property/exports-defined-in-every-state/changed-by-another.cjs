Object.defineProperty(exports, "__esModule", { value: true });
require("./helper-changes.cjs")(exports);
try { Object.defineProperty(exports, "taken", { value: "mine" }); } catch (e) { exports.error1 = e.constructor.name; }
try { Object.defineProperty(exports, "getter", { get() { return "mine"; } }); } catch (e) { exports.error2 = e.constructor.name; }
Object.defineProperty(exports, "free", { value: "mine", enumerable: true });
