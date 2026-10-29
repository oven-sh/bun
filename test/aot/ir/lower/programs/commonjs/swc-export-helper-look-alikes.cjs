// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 14

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

// GENERATED: look
// CHECK-LABEL: function {{*}}name="look"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b8():
// CHECK-NEXT: v1 = Call v0 calleeName="read"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v3 = TypeTest v2 testedType=function
// CHECK-NEXT: Branch v3 -> taken b3(| 0), notTaken b5(| 0)
// CHECK-NEXT: b3(v4) handler=b8():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b8():
// CHECK-NEXT: v5 = String string="function "
// CHECK-NEXT: v6 = PropGet v4 key="name"
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: Jump -> next b7(v7)
// CHECK-NEXT: b5(v8) handler=b8():
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b8():
// CHECK-NEXT: v9 = Builtin builtin=String
// CHECK-NEXT: v10 = Call v9, -, v8 calleeName="String"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b7(v11)
// CHECK-NEXT: b7(v12) handler=b8():
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: b8() role=CatchHandler:
// CHECK-NEXT: v14 = CatchValue
// CHECK-NEXT: v15 = PropGet v14 key="name"
// CHECK-NEXT: v16 = String string=": "
// CHECK-NEXT: v17 = Add v15, v16
// CHECK-NEXT: v18 = PropGet v14 key="message"
// CHECK-NEXT: v19 = Add v17, v18
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
