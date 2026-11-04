("use strict" as any).length;
"use strict";
console.log("behind a member of a cast:", (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })());
