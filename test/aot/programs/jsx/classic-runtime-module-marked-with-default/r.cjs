Object.defineProperty(exports, "__esModule", { value: true });
exports.default = { createElement: (t, p, ...c) => "own:" + String(t) + ":" + c.length, Fragment: "own fragment" };
exports.createElement = () => "not this one";
