// Only a plugin answers for a name that exists. A test run that names none carries no name of a statement: its image is as it was.
// RUN: link
// OPTIONS: runs-tests
// CHECK: module {{*}}path="{{*}}/helper.ts"
// CHECK-NOT: namesOfStatements=

// RUN(FIRST): link
// FIRST-NOT: namesOfStatements=
// FIRST: module {{*}}path="{{*}}/helper.ts"

// FILE: main.ts
import { seen } from "./helper.ts";
console.log(seen());

// FILE: helper.ts
import { leaf } from "./leaf.ts";
export const seen = () => leaf;

// FILE: leaf.ts
export const leaf = "leaf";
