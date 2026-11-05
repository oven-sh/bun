// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 19

// FILE: main.js
// Each of these differs in one step from the functions that bind every name of another module to the exports: the module keeps its object, and a name is read by a property access. Nothing but names is read of them here, so that nothing else makes them keep it.
const alphaModule = require("./files/default-too.js");
console.log(typeof alphaModule.alpha === "function" ? alphaModule.alpha() : alphaModule.alpha, alphaModule.alphaValue);
const betaModule = require("./files/what-is-there-is-overwritten.js");
console.log(typeof betaModule.beta === "function" ? betaModule.beta() : betaModule.beta, betaModule.betaValue);
const gammaModule = require("./files/values-are-copied.js");
console.log(typeof gammaModule.gamma === "function" ? gammaModule.gamma() : gammaModule.gamma, gammaModule.gammaValue);
const deltaModule = require("./files/not-enumerable.js");
console.log(typeof deltaModule.delta === "function" ? deltaModule.delta() : deltaModule.delta, deltaModule.deltaValue);
const epsilonModule = require("./files/under-another-name.js");
console.log(typeof epsilonModule.epsilon === "function" ? epsilonModule.epsilon() : epsilonModule.epsilon, epsilonModule.epsilonValue);
const zetaModule = require("./files/the-function-is-stored-to.js");
console.log(typeof zetaModule.zeta === "function" ? zetaModule.zeta() : zetaModule.zeta, zetaModule.zetaValue);
const etaModule = require("./files/unless-something-else-has-one.js");
console.log(typeof etaModule.eta === "function" ? etaModule.eta() : etaModule.eta, etaModule.etaValue);
const thetaModule = require("./files/one-statement-more.js");
console.log(typeof thetaModule.theta === "function" ? thetaModule.theta() : thetaModule.theta, thetaModule.thetaValue);
const iotaModule = require("./files/the-other-way-round.js");
console.log(typeof iotaModule.iota === "function" ? iotaModule.iota() : iotaModule.iota, iotaModule.iotaValue);

// FILE: files/default-too-inner.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.alphaValue = exports.alpha = void 0;
function alpha() {
    return "alpha";
}
exports.alpha = alpha;
exports.alphaValue = "alphaValue";

// FILE: files/default-too.js
"use strict";
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (!Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./default-too-inner.js"), exports);

// FILE: files/not-enumerable-inner.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deltaValue = exports.delta = void 0;
function delta() {
    return "delta";
}
exports.delta = delta;
exports.deltaValue = "deltaValue";

// FILE: files/not-enumerable.js
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: false, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./not-enumerable-inner.js"), exports);

// FILE: files/one-statement-more-inner.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.thetaValue = exports.theta = void 0;
function theta() {
    return "theta";
}
exports.theta = theta;
exports.thetaValue = "thetaValue";

// FILE: files/one-statement-more.js
"use strict";
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    exports.extra = 1;
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./one-statement-more-inner.js"), exports);

// FILE: files/the-function-is-stored-to-inner.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zetaValue = exports.zeta = void 0;
function zeta() {
    return "zeta";
}
exports.zeta = zeta;
exports.zetaValue = "zetaValue";

// FILE: files/the-function-is-stored-to.js
"use strict";
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./the-function-is-stored-to-inner.js"), exports);
__exportStar = null;

// FILE: files/the-other-way-round-inner.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.iotaValue = exports.iota = void 0;
function iota() {
    return "iota";
}
exports.iota = iota;
exports.iotaValue = "iotaValue";

// FILE: files/the-other-way-round.js
"use strict";
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(m, exports, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./the-other-way-round-inner.js"), exports);

// FILE: files/under-another-name-inner.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.epsilonValue = exports.epsilon = void 0;
function epsilon() {
    return "epsilon";
}
exports.epsilon = epsilon;
exports.epsilonValue = "epsilonValue";

// FILE: files/under-another-name.js
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k + "";
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./under-another-name-inner.js"), exports);

// FILE: files/unless-something-else-has-one-inner.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.etaValue = exports.eta = void 0;
function eta() {
    return "eta";
}
exports.eta = eta;
exports.etaValue = "etaValue";

// FILE: files/unless-something-else-has-one.js
"use strict";
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
var __exportStar = (globalThis && globalThis.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./unless-something-else-has-one-inner.js"), exports);

// FILE: files/values-are-copied-inner.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gammaValue = exports.gamma = void 0;
function gamma() {
    return "gamma";
}
exports.gamma = gamma;
exports.gammaValue = "gammaValue";

// FILE: files/values-are-copied.js
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./values-are-copied-inner.js"), exports);

// FILE: files/what-is-there-is-overwritten-inner.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.betaValue = exports.beta = void 0;
function beta() {
    return "beta";
}
exports.beta = beta;
exports.betaValue = "betaValue";

// FILE: files/what-is-there-is-overwritten.js
"use strict";
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default") __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./what-is-there-is-overwritten-inner.js"), exports);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
