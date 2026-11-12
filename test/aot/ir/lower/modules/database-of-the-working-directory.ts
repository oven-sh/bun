// An executable opens the database that lies below its working directory. The build reads no file, so none need be there.
// RUN: link
// OPTIONS: builtin-modules
// CHECK-COUNT-2: displayPath="database:
// CHECK-NOT: displayPath="database:
// CHECK: String string="{{*}}.sqlite"
// CHECK: "resolveSync"

// RUN(BELOW): link
// OPTIONS(BELOW): builtin-modules
// BELOW: module {{*}}displayPath="database:./data/absent.sqlite"

// RUN(ABOVE): link
// OPTIONS(ABOVE): builtin-modules
// ABOVE: module {{*}}displayPath="database:../above.sqlite"

// FILE: main.ts
import { db as above } from "../above.sqlite" with { type: "sqlite" };
import { db as again } from "./data/../data/absent.sqlite" with { type: "sqlite" };
import db from "./data/absent.sqlite" with { type: "sqlite" };
console.log(db === again, db === above);
