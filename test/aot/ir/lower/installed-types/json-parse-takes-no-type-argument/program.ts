// JSON.parse takes no type argument. The one that is written stops no build and says nothing about the result.
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: [[parsed]] = Call {{*}}calleeName="JSON.parse"
// CHECK-NEXT: = Call {{*}}, [[parsed]] calleeKey="log"

console.log(JSON.parse<number>("1"));
