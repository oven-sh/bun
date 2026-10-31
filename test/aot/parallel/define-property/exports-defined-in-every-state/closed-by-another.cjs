Object.defineProperty(exports, "__esModule", { value: true });
require("./helper-closes.cjs")(exports);
try { Object.defineProperty(exports, "late", { value: "mine" }); } catch (e) { console.log("closed-by-another:", e.constructor.name, e.message); }
