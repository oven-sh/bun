var __importDefault = (this && this.__importDefault) || function (mod) { return (mod && mod.__esModule) ? mod : { "default": mod }; };
const early = __importDefault(require("./early.cjs"));
exports.seen = [typeof early.default, require("./early.cjs").__esModule].join("|");
