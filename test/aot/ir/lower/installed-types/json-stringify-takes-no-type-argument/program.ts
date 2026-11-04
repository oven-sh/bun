// JSON.stringify takes no type argument. The one that is written stops no build, and the result has the type that the declaration gives it.
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: [[text]] = Call {{*}}calleeName="JSON.stringify"
// CHECK-NEXT: [[converted]] = Convert [[text]] declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: = Call {{*}}, [[converted]] calleeKey="log"

console.log(JSON.stringify<number>(1));
