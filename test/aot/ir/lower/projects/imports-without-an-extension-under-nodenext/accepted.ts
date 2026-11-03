// A relative import without its extension is no error in a build: nothing is emitted for Node to load.
// RUN: link
// CHECK: module [[es]] path="{{*}}/node_modules/pkg/lib/es.js"
// CHECK-NOT: common.cjs
// CHECK: entry

import { value } from "./imports/src/value";
import { inFolder } from "./imports/src/folder";
import { value as written } from "./imports/src/value.js";
import { inFolder as writtenInFolder } from "./imports/src/folder/index.js";
import { how } from "pkg";

export const late = import("./imports/src/value");
export const all = [value, inFolder, written, writtenInFolder, how];
