// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 14
// CHECK-LABEL: function {{*}}name="look"

// FILE: main.cjs
// Modules that call something like SWC's `_export(exports, { .. })`, each a little off the form: what a reader of the names and a look at the object find is what plain Bun finds.
"use strict";
function look(read) { try { const value = read(); return typeof value === "function" ? "function " + value.name : String(value); } catch (error) { return error.name + ": " + error.message; } }

const _live = require("./live-binding.cjs");
console.log("live binding", _live.a, (0, _live.bump)(), _live.a);

const _effects = require("./getter-with-effects.cjs");
console.log("getter with effects", _effects.a, _effects.a, (0, _effects.reads)());

const _hidden = require("./not-enumerable.cjs");
console.log("not enumerable", _hidden.a, Object.keys(_hidden).join());

const _open = require("./configurable.cjs");
console.log("configurable", _open.a, delete _open.a, _open.a);

const _swapped = require("./helper-replaced.cjs");
console.log("helper replaced", look(() => _swapped.a), look(() => _swapped.b));

const _late = require("./called-late.cjs");
console.log("called late", look(() => _late.a), (0, _late.define)(), look(() => _late.a));

const _other = require("./another-target.cjs");
console.log("another target", look(() => _other.a), look(() => _other.holder.a));

const _order = require("./order-of-names.cjs");
console.log("order of names", _order.b, _order.a, _order[1], _order[0]);
console.log("order of names, looked at", Object.keys(require("./order-of-names-looked-at.cjs")).join());

console.log("no getter", look(() => require("./value-in-place-of-a-getter.cjs").a));

const _stored = require("./stored-behind-the-definition.cjs");
console.log("stored behind the definition", look(() => _stored.a), look(() => _stored.result));

console.log("defined twice", look(() => require("./defined-twice.cjs").a));

const _shadow = require("./object-shadowed.cjs");
console.log("Object shadowed", look(() => _shadow.a), _shadow.calls);

// FILE: another-target.cjs
"use strict";
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
const holder = {};
_export(holder, {
    a: function() {
        return a;
    }
});
exports.holder = holder;
const a = "a";

// FILE: called-late.cjs
"use strict";
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
exports.define = function () {
    _export(exports, {
        a: function() {
            return a;
        }
    });
    return "defined";
};
const a = "a";

// FILE: configurable.cjs
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        configurable: true,
        get: all[name]
    });
}
_export(exports, {
    a: function() {
        return a;
    }
});
const a = "a";

// FILE: defined-twice.cjs
"use strict";
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    a: function() {
        return a;
    }
});
_export(exports, {
    a: function() {
        return b;
    }
});
const a = "a", b = "b";

// FILE: getter-with-effects.cjs
"use strict";
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    a: function() {
        count++;
        return a;
    },
    reads: function() {
        return reads;
    }
});
var count = 0;
const a = "a";
function reads() { return count; }

// FILE: helper-replaced.cjs
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export = function (target, all) { target.b = Object.keys(all).join(); };
_export(exports, {
    a: function() {
        return a;
    }
});
const a = "a";

// FILE: live-binding.cjs
"use strict";
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    a: function() {
        return a;
    },
    bump: function() {
        return bump;
    }
});
let a = 1;
function bump() { a++; return a; }

// FILE: not-enumerable.cjs
"use strict";
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: false,
        get: all[name]
    });
}
_export(exports, {
    a: function() {
        return a;
    }
});
const a = "a";

// FILE: object-shadowed.cjs
"use strict";
var calls = 0;
var Object = { defineProperty(target, name, descriptor) { calls++; target[name] = "from the shadow"; } };
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    a: function() {
        return a;
    }
});
const a = "a";
exports.calls = calls;

// FILE: order-of-names-looked-at.cjs
"use strict";
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    b: function() {
        return b;
    },
    1: function() {
        return one;
    },
    a: function() {
        return a;
    },
    0: function() {
        return zero;
    }
});
const a = "a", b = "b", one = "one", zero = "zero";

// FILE: order-of-names.cjs
"use strict";
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    b: function() {
        return b;
    },
    1: function() {
        return one;
    },
    a: function() {
        return a;
    },
    0: function() {
        return zero;
    }
});
const a = "a", b = "b", one = "one", zero = "zero";

// FILE: stored-behind-the-definition.cjs
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    a: function() {
        return a;
    }
});
const a = "a";
exports.a = "stored";
exports.result = exports.a;

// FILE: value-in-place-of-a-getter.cjs
"use strict";
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    a: 1
});

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
