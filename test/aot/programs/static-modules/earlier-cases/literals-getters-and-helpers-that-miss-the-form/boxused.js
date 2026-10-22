var __importDefault = (this && this.__importDefault) || function (mod) { return (mod && mod.__esModule) ? mod : { "default": mod }; };
const box = __importDefault(require("./plain4"));
exports.seen = Object.keys(box).join() + ":" + box.p + ":" + box.default.p;
