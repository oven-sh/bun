// A store in the head of a for-of counts: the `__importDefault` that it puts on `this` is the one in use.
for (this.__importDefault of [() => ({ default: { a: "replaced" } })]);
var __importDefault = (this && this.__importDefault) || function (mod) { return (mod && mod.__esModule) ? mod : { "default": mod }; };
console.log(__importDefault(require("./o")).default.a);
