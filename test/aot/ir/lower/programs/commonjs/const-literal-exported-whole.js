// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 11

// FILE: main.js
// `const keys = { .. }; module.exports = keys`: what the module exports is the literal, whoever asks and however, and symbols made there are keys like any other.
"use strict";
const lines = [];
function show(what, value) { lines.push(what + ": " + String(value)); }
function outcome(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }

const { kState, kCount, kShared, limit, double } = require("./keys");
const keys = require("./keys.js");

function Thing(value) {
    this[kState] = value;
    this[kCount] = 0;
    this.plain = value;
}
Thing.prototype.bump = function bump() {
    this[kCount] = this[kCount] + 1;
    return this[kState];
};

let total = 0;
let last;
for (let i = 0; i < 300; i++) {
    last = new Thing(i);
    total += last.bump() + last.bump() + last[keys.kCount];
}
show("total", total);
show("the same however it is asked for", [keys.kState === kState, keys.kCount === kCount, require("./keys").kShared === kShared, kShared === Symbol.for("shared by its text")].join());
show("texts", [String(kState), String(kCount), String(kShared)].join());
show("own symbols", Object.getOwnPropertySymbols(last).map(String).join());
show("the symbols listed are the constants", Object.getOwnPropertySymbols(last).every((symbol, index) => symbol === [kState, kCount][index]));
show("what else it exports", [limit, double(limit), keys.limit, keys.double(4), typeof keys.absent, keys.onlyReadThroughTheObject].join());

const changed = require("./changed-later");
show("stored to from outside", [String(changed.read().kFirst), changed.read().kFirst === changed.before, changed.read().added].join());
const listed = require("./listed");
show("listed", [Object.keys(listed.keys).join(), listed.keys.kOnly === listed.again().kOnly, String(listed.keys.kOnly)].join());
const used = require("./used-by-its-own-module");
show("used by its own module", [used.exported.kOwn === used.own(), String(used.own())].join());
const between = require("./something-in-between");
show("something in between", [between.seen, String(between.keys.kLate)].join());
const twice = require("./reassigned");
show("reassigned", [String(twice.kSecond), typeof twice.kFirst].join());
show("a cycle", require("./cycle-a").told.join());
console.log(lines.join("\n"));

// FILE: changed-later-keys.js
"use strict";
const keys = {
    kFirst: Symbol("first"),
};
module.exports = keys;

// FILE: changed-later.js
"use strict";
const holder = require("./changed-later-keys");
const before = holder.kFirst;
holder.added = "added from outside";
module.exports = { before, read() { return require("./changed-later-keys"); } };

// FILE: cycle-a.js
"use strict";
const told = [];
exports.told = told;
const b = require("./cycle-b");
told.push("a has " + String(b.kOfB));

// FILE: cycle-b.js
"use strict";
const a = require("./cycle-a");
a.told.push("b runs while a is evaluated");
const keys = {
    kOfB: Symbol("of b"),
};
module.exports = keys;

// FILE: keys.js
"use strict";

const keys = {
    kState: Symbol("state"),
    kCount: Symbol("count"),
    kShared: Symbol.for("shared by its text"),
    limit: 21,
    onlyReadThroughTheObject: 5,
    double(value) { return value * 2; },
};

module.exports = keys;

// FILE: listed-keys.js
"use strict";
const keys = {
    kOnly: Symbol("only"),
};
module.exports = keys;

// FILE: listed.js
"use strict";
const keys = require("./listed-keys");
module.exports = { keys, again() { return require("./listed-keys"); } };

// FILE: reassigned.js
"use strict";
let keys = {
    kFirst: Symbol("first"),
};
keys = { kSecond: Symbol("second") };
module.exports = keys;

// FILE: something-in-between.js
"use strict";
function peek() { return typeof module.exports.kLate; }
const keys = {
    kLate: Symbol("late"),
};
const seen = peek();
module.exports = keys;
module.exports = { keys: module.exports, seen };

// FILE: used-by-its-own-module.js
"use strict";
const keys = {
    kOwn: Symbol("own"),
};
module.exports = keys;
module.exports = { exported: keys, own() { return keys.kOwn; } };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: show outcome Thing bump
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|boolean|number|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|boolean|number|string):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="lines"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = String string=": "
// CHECK-NEXT: v6 = Add v0, v5
// CHECK-NEXT: v7 = Builtin builtin=String
// CHECK-NEXT: v8 = Call v7, -, v1 calleeName="String"
// CHECK-NEXT: v9 = Add v6, v8
// CHECK-NEXT: v10 = Call v4, v3, v9 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="outcome"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = NewRuntimeError runtimeError=LeftOutOfExecutable name="outcome"
// CHECK-NEXT: Throw v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Thing"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_2]] flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_2]], v1: anything):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="kState"
// CHECK-NEXT: ElemSet v0, v3, v1
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="kCount"
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: ElemSet v0, v6, v7
// CHECK-NEXT: PropSet v0, v1 key="plain"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="bump"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="kCount"
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="kCount"
// CHECK-NEXT: v5 = ElemGet v0, v4
// CHECK-NEXT: v6 = Integer integer=1
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: ElemSet v0, v2, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="kState"
// CHECK-NEXT: v11 = ElemGet v0, v10
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
