// STATISTIC: ModulesWithValue >= 2
// A bundle of webpack inside two functions that run once each: its bodies are modules.
(() => {
var out;
(() => { var e = { 21: () => {}, 202: () => {}, 247: () => {}, 387: e => { function webpackEmptyContext(e) { var t = new Error("Cannot find module '" + e + "'"); throw t.code = "MODULE_NOT_FOUND", t } webpackEmptyContext.keys = () => [], webpackEmptyContext.resolve = webpackEmptyContext, webpackEmptyContext.id = 387, e.exports = webpackEmptyContext }, 615: () => {}, 641: () => {}, 843: (e, t, n) => { var i0 = {}; (e => { "use strict"; var t=Object.defineProperty,i=(Object.getOwnPropertyDescriptor,Object.getOwnPropertyNames,Object.prototype.hasOwnProperty,(e,n)=>{for(var r in n)t(e,r,{get:n[r],enumerable:!0})}),ts_exports={};t(ts_exports, "run", { get: () => run, enumerable: true }); t(ts_exports, "create", { get: () => create, enumerable: true }); t(ts_exports, "depth", { get: () => depth, enumerable: true }); t(ts_exports, "setObjectAllocator", { get: () => setObjectAllocator, enumerable: true }); t(ts_exports, "createBaseNode", { get: () => createBaseNode, enumerable: true }); t(ts_exports, "Node4", { get: () => Node4, enumerable: true }); t(ts_exports, "makeToken", { get: () => makeToken, enumerable: true }); t(ts_exports, "makeIdentifier", { get: () => makeIdentifier, enumerable: true }); t(ts_exports, "makePrivateIdentifier", { get: () => makePrivateIdentifier, enumerable: true }); t(ts_exports, "makeSourceFile", { get: () => makeSourceFile, enumerable: true }); t(ts_exports, "makeSymbol", { get: () => makeSymbol, enumerable: true }); t(ts_exports, "makeType", { get: () => makeType, enumerable: true }); t(ts_exports, "makeSignature", { get: () => makeSignature, enumerable: true }); t(ts_exports, "makeSourceMap", { get: () => makeSourceMap, enumerable: true }); t(ts_exports, "CToken", { get: () => CToken, enumerable: true }); t(ts_exports, "CIdentifier", { get: () => CIdentifier, enumerable: true }); t(ts_exports, "CPrivateIdentifier", { get: () => CPrivateIdentifier, enumerable: true }); t(ts_exports, "CSourceFile", { get: () => CSourceFile, enumerable: true }); t(ts_exports, "CSymbol", { get: () => CSymbol, enumerable: true }); t(ts_exports, "CType", { get: () => CType, enumerable: true }); t(ts_exports, "CSignature", { get: () => CSignature, enumerable: true }); t(ts_exports, "CSourceMap", { get: () => CSourceMap, enumerable: true }); t(ts_exports, "objectAllocator", { get: () => Bn, enumerable: true }); t(ts_exports, "NodeObject", { get: () => wl, enumerable: true });
e.exports = ts_exports;
 function CToken(a, b) { this.xToken = a; this.y = b; }
var DToken = class { constructor(a, b) { this.xToken = a; this.z = b; } };
function CIdentifier(a, b) { this.xIdentifier = a; this.y = b; }
var DIdentifier = class { constructor(a, b) { this.xIdentifier = a; this.z = b; } };
function CPrivateIdentifier(a, b) { this.xPrivateIdentifier = a; this.y = b; }
var DPrivateIdentifier = class { constructor(a, b) { this.xPrivateIdentifier = a; this.z = b; } };
function CSourceFile(a, b) { this.xSourceFile = a; this.y = b; }
var DSourceFile = class { constructor(a, b) { this.xSourceFile = a; this.z = b; } };
function CSymbol(a, b) { this.xSymbol = a; this.y = b; }
var DSymbol = class { constructor(a, b) { this.xSymbol = a; this.z = b; } };
function CType(a, b) { this.xType = a; this.y = b; }
var DType = class { constructor(a, b) { this.xType = a; this.z = b; } };
function CSignature(a, b) { this.xSignature = a; this.y = b; }
var DSignature = class { constructor(a, b) { this.xSignature = a; this.z = b; } };
function CSourceMap(a, b) { this.xSourceMap = a; this.y = b; }
var DSourceMap = class { constructor(a, b) { this.xSourceMap = a; this.z = b; } };
function Node4(kind, pos, end) { this.pos = pos; this.end = end; this.kind = kind; this.id = 0; this.flags = 0; this.parent = undefined; }
var Bn = { getNodeConstructor: () => Node4, getTokenConstructor: () => CToken, getIdentifierConstructor: () => CIdentifier, getPrivateIdentifierConstructor: () => CPrivateIdentifier, getSourceFileConstructor: () => CSourceFile, getSymbolConstructor: () => CSymbol, getTypeConstructor: () => CType, getSignatureConstructor: () => CSignature, getSourceMapConstructor: () => CSourceMap }, jn = [];
function addPatcher(e) { jn.push(e), e(Bn); }
addPatcher(a => { globalThis.q = typeof a.getNodeConstructor; });
function setObjectAllocator(e) { Object.assign(Bn, e); for (const f of jn) f(Bn); }
var wl = class NodeObject { constructor(kind, pos, end) { this.pos = pos; this.end = end; this.kind = kind; this.id = 0; this.flags = 0; this.parent = undefined; } getStart() { return this.pos; } };
setObjectAllocator(function getServices() { return { getNodeConstructor: () => wl, getTokenConstructor: () => DToken, getIdentifierConstructor: () => DIdentifier, getPrivateIdentifierConstructor: () => DPrivateIdentifier, getSourceFileConstructor: () => DSourceFile, getSymbolConstructor: () => DSymbol, getTypeConstructor: () => DType, getSignatureConstructor: () => DSignature, getSourceMapConstructor: () => DSourceMap }; }());
var kToken; function makeToken(a) { return new (kToken || (kToken = Bn.getTokenConstructor()))(a, 2); }
var kIdentifier; function makeIdentifier(a) { return new (kIdentifier || (kIdentifier = Bn.getIdentifierConstructor()))(a, 2); }
var kPrivateIdentifier; function makePrivateIdentifier(a) { return new (kPrivateIdentifier || (kPrivateIdentifier = Bn.getPrivateIdentifierConstructor()))(a, 2); }
var kSourceFile; function makeSourceFile(a) { return new (kSourceFile || (kSourceFile = Bn.getSourceFileConstructor()))(a, 2); }
var kSymbol; function makeSymbol(a) { return new (kSymbol || (kSymbol = Bn.getSymbolConstructor()))(a, 2); }
var kType; function makeType(a) { return new (kType || (kType = Bn.getTypeConstructor()))(a, 2); }
var kSignature; function makeSignature(a) { return new (kSignature || (kSignature = Bn.getSignatureConstructor()))(a, 2); }
var kSourceMap; function makeSourceMap(a) { return new (kSourceMap || (kSourceMap = Bn.getSourceMapConstructor()))(a, 2); }
var ctor;
function createBaseNode(t) { return new (ctor || (ctor = Bn.getNodeConstructor()))(t, -1, -1); }
function create(kind, parent) { const n = createBaseNode(kind); n.parent = parent; return n; }
function depth(n) { let d = 0; while (n) { if (n.kind === 3) d++; d += n.flags; n = n.parent; } return d; }
function run(m) { let s = 0; s += makeToken(1).xToken; s += makeIdentifier(1).xIdentifier; s += makePrivateIdentifier(1).xPrivateIdentifier; s += makeSourceFile(1).xSourceFile; s += makeSymbol(1).xSymbol; s += makeType(1).xType; s += makeSignature(1).xSignature; s += makeSourceMap(1).xSourceMap; for (let i = 0; i < m; i++) { let p; for (let k = 0; k < 8; k++) p = create(k & 3, p); s += depth(p); } return s; }

})({ get exports() { return i0 }, set exports(t) { i0 = t, e.exports && (e.exports = t) } }) } }, t = {};
function __webpack_require__(n) { var r = t[n]; if (void 0 !== r) return r.exports; var i = t[n] = { exports: {} }; return e[n](i, i.exports, __webpack_require__), i.exports }
__webpack_require__.d = (e, t) => { for (var n in t) __webpack_require__.o(t, n) && !__webpack_require__.o(e, n) && Object.defineProperty(e, n, { enumerable: !0, get: t[n] }) }, __webpack_require__.o = (e, t) => Object.prototype.hasOwnProperty.call(e, t), __webpack_require__.r = e => { "undefined" != typeof Symbol && Symbol.toStringTag && Object.defineProperty(e, Symbol.toStringTag, { value: "Module" }), Object.defineProperty(e, "__esModule", { value: !0 }) };
var n = {}; (() => { "use strict"; __webpack_require__.r(n), __webpack_require__.d(n, { compileTest: () => compileTest }); var e = __webpack_require__(843); function compileTest(m) { return e.run(m); } })(), out = n })();
console.log(out.compileTest(1000));
console.log(out.compileTest(37));

})();
