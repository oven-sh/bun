// RUN: link
// CHECK: module [[used]] path="{{*}}pure-package/used.js"
// CHECK: module [[waiting]] path="{{*}}package-with-effects/waiting.js"
// CHECK: module [[bare]] path="{{*}}package-with-effects/bare.js"
// CHECK: module [[byName]] path="{{*}}pure-package/by-name.js"{{*}}requests=[{target=[[used]] completes=true}, {target=[[waiting]] completes=true}, {target=[[bare]] completes=true}]
// CHECK: module {{*}}files-of-a-package-without-side-effects.js"{{*}}requests=[{target=[[byName]] completes=true}]

// RUN(ABSENT): link
// ABSENT-NOT: displayPath="node_modules/pure-package/index.js"
// ABSENT-NOT: displayPath="node_modules/pure-package/unused.js"

// The package says that nothing is lost without its files. One that nothing is used of is not in the program. `export *` names nothing, so
// the import goes past index.js, and the importer asks for what index.js asked for. by-name.js hands the name on in a statement of its own
// and is evaluated. It is what an `export *` exports, so, as for the bundler, its statements wait for nothing.
import { used } from "pure-package";

console.log(used());
