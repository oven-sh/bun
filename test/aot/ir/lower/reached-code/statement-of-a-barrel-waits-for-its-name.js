// RUN: link
// CHECK: module [[used]] path="{{*}}pure-package/used.js"
// CHECK: module [[bare]] path="{{*}}package-with-effects/bare.js"
// CHECK: module {{*}}pure-package/by-name.js"{{*}}requests=[{target=[[used]] completes=true}, {target=[[bare]] completes=true}]

// RUN(ABSENT): link
// ABSENT-NOT: displayPath="node_modules/package-with-effects/waiting.js"

// A file of a package without side effects that defines none of the names it exports is a barrel. A statement of it that hands names on
// waits until one of them is asked for, whatever the other file does when it is evaluated. An import that binds no name does not wait.
import { used } from "pure-package/by-name.js";

console.log(used());
