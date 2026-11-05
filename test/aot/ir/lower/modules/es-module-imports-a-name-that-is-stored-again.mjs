// RUN: lower
// CHECK-LABEL: function {{*}}name="read"
// CHECK: = Call {{*}}calleeName="set"
// CHECK-NEXT: [[copy]] = GetModuleVariable
// CHECK-NEXT: = CheckInitialized [[copy]] name="n"
// CHECK: Return

// RUN(RECORDS): link
// RECORDS: module {{*}}displayPath="{{*}}stored-again.cjs" kind=CommonJs

// RUN(FACERECORD): link
// FACERECORD: module {{*}}path="#{{*}}" displayPath="{{*}}stored-again.cjs" flags=[{{*}}requests=[{target=m

// RUN(FACE): link
// FACE: EvaluateModule module=m{{*}} [isBare]
// FACE-NEXT: [[live]] = GetModuleVariable
// FACE-NEXT: PutModuleVariable [[live]]

// A function of the CommonJS file stores the name again, so an ES importer holds a copy. A module of its own takes the copy when the file is first linked into a graph of ES modules, and the importer requests that module.
import { n, set } from "./imports/chain/stored-again.cjs";
export function read() {
  set();
  return n;
}
