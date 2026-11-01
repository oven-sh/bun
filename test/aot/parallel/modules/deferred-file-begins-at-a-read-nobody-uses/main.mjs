// `import defer * as later`: the file begins where a member of `later` is first read, whether or not anything takes the value that is read.
console.log("# a-statement");
await import("./a-statement/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# in-parentheses");
await import("./in-parentheses/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# a-quoted-key");
await import("./a-quoted-key/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# a-function-of-the-file");
await import("./a-function-of-the-file/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# a-name-that-is-not-exported");
await import("./a-name-that-is-not-exported/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# under-void");
await import("./under-void/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# under-typeof");
await import("./under-typeof/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# under-not");
await import("./under-not/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# left-of-a-comma");
await import("./left-of-a-comma/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# a-const-nobody-reads");
await import("./a-const-nobody-reads/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# a-let-nobody-reads");
await import("./a-let-nobody-reads/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# a-var-nobody-reads");
await import("./a-var-nobody-reads/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# an-export-nobody-reads");
await import("./an-export-nobody-reads/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# the-test-of-a-conditional");
await import("./the-test-of-a-conditional/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# left-of-and");
await import("./left-of-and/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# left-of-or");
await import("./left-of-or/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# left-of-two-question-marks");
await import("./left-of-two-question-marks/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# compared");
await import("./compared/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# in-a-list");
await import("./in-a-list/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# in-an-object-literal");
await import("./in-an-object-literal/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# a-static-field-of-a-class-nobody-uses");
await import("./a-static-field-of-a-class-nobody-uses/reader.mjs").catch(error =>
  console.log("rejected:", error.message),
);
console.log("# a-static-block-of-a-class-nobody-uses");
await import("./a-static-block-of-a-class-nobody-uses/reader.mjs").catch(error =>
  console.log("rejected:", error.message),
);
console.log("# an-argument-of-a-call-marked-pure");
await import("./an-argument-of-a-call-marked-pure/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# in-front-of-a-read-that-is-used");
await import("./in-front-of-a-read-that-is-used/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# then-begins-nothing");
await import("./then-begins-nothing/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# the-object-alone-begins-nothing");
await import("./the-object-alone-begins-nothing/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# a-symbol-key-begins-nothing");
await import("./a-symbol-key-begins-nothing/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# a-function-nobody-calls-begins-nothing");
await import("./a-function-nobody-calls-begins-nothing/reader.mjs").catch(error =>
  console.log("rejected:", error.message),
);
console.log("# the-file-throws");
await import("./the-file-throws/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# under-a-cast");
await import("./under-a-cast/reader.ts").catch(error => console.log("rejected:", error.message));
