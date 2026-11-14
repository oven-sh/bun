// RUN: link
// CHECK: module {{*}}imports/two-functions.ts"{{*}}exports=[{name="used" variable=[[used]]}]

// The object of the module is asked for one name, and shows that one.
import * as functions from "./imports/two-functions";

export function read(): () => number {
  return functions.used;
}
