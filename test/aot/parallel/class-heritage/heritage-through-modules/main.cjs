// Classes extend what other files export: by default behind a helper of interop, behind a star, by a getter that Babel or esbuild defines, by a namespace.
// STATISTIC: AllocationsTypedByRunningConstructor >= 8
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) { return (mod && mod.__esModule) ? mod : { "default": mod }; };
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) { if (k2 === undefined) k2 = k; var desc = Object.getOwnPropertyDescriptor(m, k); if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) { desc = { enumerable: true, get: function() { return m[k]; } }; } Object.defineProperty(o, k2, desc); }) : (function(o, m, k, k2) { if (k2 === undefined) k2 = k; o[k2] = m[k]; }));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) { Object.defineProperty(o, "default", { enumerable: true, value: v }); }) : function(o, v) { o["default"] = v; });
var __importStar = (this && this.__importStar) || function (mod) { if (mod && mod.__esModule) return mod; var result = {}; if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k); __setModuleDefault(result, mod); return result; };
var __exportStar = (this && this.__exportStar) || function(m, exports) { for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p); };
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const out = [];
const show = (run) => { try { return String(run()); } catch (error) { return error.constructor.name; } };
const base_1 = __importDefault(require("./modules/base.cjs")), whole_1 = __importDefault(require("./modules/whole.cjs")), star_1 = require("./modules/index-star.cjs"), babel_1 = require("./modules/index-babel-getter.cjs"), { Base: OfEsbuild } = require("./modules/index-esbuild.cjs"), space = __importStar(require("./modules/base.cjs"));
var _base = _interopRequireDefault(require("./modules/base.cjs")), _whole = _interopRequireDefault(require("./modules/whole.cjs"));
class A extends base_1.default { constructor(n, m) { super(n); this.m = m; } sum() { return this.n + this.m + this.own.length; } }
class B extends whole_1.default { constructor(n, m) { super(n); this.m = m; this.b = null; } sum() { return this.n + this.m + this.twice; } }
class C extends star_1.Base { constructor(n, m) { super(n); this.m = m; } sum() { return this.n + this.m + this.list.length; } }
class D extends babel_1.Base { constructor(n, m) { super(n); this.m = m; } sum() { return this.n * this.m; } }
class E extends OfEsbuild { constructor(n, m) { super(n); this.m = m; } sum() { return this.n - this.m; } }
class F extends space.Base { constructor(n, m) { super(n); this.m = m; } sum() { return this.n + this.m + 1; } }
class G extends space.default { constructor(n, m) { super(n); this.m = m; } sum() { return this.n + this.m + 2; } }
class H extends _base.default { constructor(n, m) { super(n); this.m = m; } sum() { return this.n + this.m + 3; } }
class I extends _whole.default { constructor(n, m) { super(n); this.m = m; } sum() { return this.n + this.m + 4; } }
for (const Class of [A, B, C, D, E, F, G, H, I]) { let total = 0; for (let i = 0; i < 60; i++) total += new Class(i, 2).add(1).sum(); out.push(Class.name + total, JSON.stringify(new Class(1, 2)), Object.keys(new Class(3)).join(), Class.from ? show(() => Class.from(4).sum()) : "-"); }
out.push(new A(1) instanceof require("./modules/base.cjs").default, new C(1) instanceof space.Base, new D(1) instanceof base_1.default);
const ring = require("./modules/index-ring-a.cjs");
class J extends ring.A { constructor() { super(); this.j = 1; } }
out.push(JSON.stringify(new J()), show(() => JSON.stringify(new (class K extends ring.B { constructor() { super(); this.k = 1; } })())), show(() => typeof class extends ring.missing {}));
const changed_1 = __importDefault(require("./modules/changed.cjs"));
class M extends changed_1.default { constructor() { super(); this.m = 1; } }
out.push(JSON.stringify(new M()), new M().who());
require("./modules/changed.cjs").change();
class N extends changed_1.default { constructor() { super(); this.n = 1; } }
out.push(JSON.stringify(new N()), new N().who(), JSON.stringify(new M()));
Object.setPrototypeOf(A, class Other { constructor() { this.other = 1; } }); Object.setPrototypeOf(A.prototype, { add() { return this; } });
out.push(JSON.stringify(new A(9, 8)), show(() => new A(9).add().sum()), show(() => Reflect.construct(B, [1, 2], C).sum()));
for (const line of out) console.log(line);
