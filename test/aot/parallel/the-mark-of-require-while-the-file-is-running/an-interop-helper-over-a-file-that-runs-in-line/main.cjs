var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const kit_1 = __importDefault(require("./kit.mjs"));
console.log("SAID default", typeof kit_1.default, kit_1.default === 7, Object.keys(kit_1).join());
