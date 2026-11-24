// __importDefault joined to its guard by &&: the name holds undefined and the call throws.
var __importDefault = (this && this.__importDefault) && function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
try {
  const path_1 = __importDefault(require("node:path"));
  console.log(typeof path_1.default.join);
} catch (error) {
  console.log(error instanceof TypeError, error.message.split(". (In")[0]);
}
console.log(typeof __importDefault);
