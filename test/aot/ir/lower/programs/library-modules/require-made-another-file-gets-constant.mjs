// RUN: lower
// OPTIONS: builtin-modules

// FILE: require-made-another-file-gets-constant.mjs
// A require that createRequire has made for another file finds other packages than the file's own, and the same library modules: one that is named by a constant is in, though nothing else names it. The output is that of plain Bun.
import { createRequire } from "module";
import * as moduleModule from "node:module";
var require = createRequire("/");
var Worker;
try {
  Worker = require("worker_threads").Worker;
} catch (e) {}
console.log("in a variable named require:", typeof Worker);
console.log("on the spot:", typeof createRequire("/somewhere/else/")("node:dgram").createSocket);
console.log("through the module's object:", typeof moduleModule.createRequire(process.cwd() + "/")("node:readline").createInterface);
console.log("with and without the prefix:", require("node:querystring") === require("querystring"));
const again = require;
console.log("through a second binding:", typeof again("node:tty").isatty);
try {
  require("no-such-package-anywhere");
} catch (error) {
  console.log("a package that is not there:", error.code);
}

let stored = createRequire("/");
stored = name => "mine " + name;
console.log("a binding that is stored to:", stored("node:zlib"));
{
  const createRequire = () => name => "own " + name;
  console.log("another function of that name:", createRequire("/")("node:zlib"));
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: stored createRequire
// CHECK-LABEL: function {{*}}name="stored"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = String string="mine "
// CHECK-NEXT: v2 = Add v1, v0
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="createRequire"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
