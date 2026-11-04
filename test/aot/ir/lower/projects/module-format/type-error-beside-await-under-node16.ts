// RUN: lower

// A file with a top-level `await` under Node16 counts as checked: the type that is written is sent. That the value does not fit it stops no build.
// CHECK: function {{*}}kind=Module flags=[IsAsync, IsChecked]
// CHECK: Await
// CHECK: [[text]] = String string="text"
// CHECK-NEXT: Convert [[text]] declared={type=number}

// FILE: main.ts
const one = await Promise.resolve(1);
console.log(one);
export {};
const wrong: number = "text";
console.log(wrong);

// FILE: package.json
{"name":"module-format-rules"}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ES2022","lib":["ESNext","DOM"],"noEmit":true,"types":[],"strict":true,"module":"Node16","moduleResolution":"Node16"}}
