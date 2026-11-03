function viaDefine() { return "defineProperty with a value"; }
function viaGetter() { return "defineProperty with a getter"; }

Object.defineProperty(exports, "viaDefine", { enumerable: true, value: viaDefine });
Object.defineProperty(exports, "viaGetter", { enumerable: true, get: function () { return viaGetter; } });
