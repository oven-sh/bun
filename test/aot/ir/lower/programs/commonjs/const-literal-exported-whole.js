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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|boolean|number|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: undefined|null|string, v2: undefined|null|boolean|number|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="lines"
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v1, v7
// CHECK-NEXT: v9 = Builtin builtin=String
// CHECK-NEXT: v10 = Call v9, -, v2 calleeName="String"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v12 = Add v8, v11
// CHECK-NEXT: v13 = Call v6, v4, v12 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="outcome"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewRuntimeError runtimeError=LeftOutOfExecutable name="outcome"
// CHECK-NEXT: Throw v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Thing"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=[[L_3]] flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: [[L_3]], v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Convert v1 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v4 = GetEnvironmentField v0 layout=[[L_1]] field=1
// CHECK-NEXT: v5 = CheckInitialized v4 name="kState"
// CHECK-NEXT: ElemSet v3, v5, v2
// CHECK-NEXT: v7 = Convert v1 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v8 = GetEnvironmentField v0 layout=[[L_1]] field=2
// CHECK-NEXT: v9 = CheckInitialized v8 name="kCount"
// CHECK-NEXT: v10 = Integer
// CHECK-NEXT: ElemSet v7, v9, v10
// CHECK-NEXT: v12 = Convert v1 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: PropSet v12, v2 key="plain"
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="bump"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasExplicitName] captures=[{type=undefined|null|symbol flags=[IsExpected]}, {type=undefined|null|symbol flags=[IsExpected]}] thisType={type=undefined|null|object flags=[IsExpected]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|symbol, v1: undefined|null|symbol, v2: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = ElemGet v2, v1
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Add v4, v5
// CHECK-NEXT: ElemSet v2, v1, v6
// CHECK-NEXT: v8 = ElemGet v2, v0
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
