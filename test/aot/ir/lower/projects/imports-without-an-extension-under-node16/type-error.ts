// What is imported without the extension has the type that its file declares: `typeof value` is `number`. That the number does not fit `string` stops no build.
// RUN: link
// CHECK: CheckInitialized {{*}}name="value"
// CHECK-NEXT: [[first]] = Integer integer=1
// CHECK-NEXT: Convert [[first]] declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK: CheckInitialized {{*}}name="value"
// CHECK-NEXT: [[second]] = Integer integer=1
// CHECK-NEXT: Convert [[second]] declared={type=number}

import { value } from "./imports/src/value";

export const text: string = value;
export const copy: typeof value = value;
