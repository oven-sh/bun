Object.defineProperty(exports, "__esModule", { value: true });
const marked = require("./marked.cjs");
Object.defineProperty(exports, "first", { enumerable: true, get: function () { return marked.plain; } });
Object.defineProperty(exports, "second", { enumerable: true, get: function () { return marked.fixed; } });
Object.defineProperty(exports, "hidden", { get() { return marked.hidden; }, set(value) { marked.hidden = value; }, configurable: true });
