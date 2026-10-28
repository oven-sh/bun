"use strict";
exports.__exportStar = function (m, exports) {
    exports.starredBy = "the helper found on this";
    exports.starredNames = Object.keys(m).length;
};
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.value = void 0;
const strict_1 = __importDefault(require("./this-strict.cjs"));
exports.value = Object.keys(strict_1.default).join();
const sloppy = __importStar(require("./this-sloppy.cjs"));
exports.namesOfStar = Object.keys(sloppy).join();
exports.readThroughStar = [sloppy.viaThis, sloppy.readOnly, sloppy.getterOnly, sloppy.tooLate, sloppy.default === require("./this-sloppy.cjs")];
__exportStar(require("./this-in-arrows.cjs"), exports);
exports.whereTheHelpersCameFrom = [__exportStar === this.__exportStar, typeof this.__importStar, typeof this.__importDefault, typeof this.__createBinding];
