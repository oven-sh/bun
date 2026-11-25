// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[port]] = Integer integer=8080
// CHECK-NEXT: = Convert [[port]] declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}

// The build reads the member out of the file. Nobody compares its type with the annotation: the program builds, and the value is converted to what is written.

// FILE: main.ts
import settings from "./settings.conf" with { type: "json" }; // @ts-expect-error
const port: string = settings.port;
console.log(port);

// FILE: settings.conf
{ "port": 8080, "hosts": ["a", "b"] }

// FILE: note.tpl
hello
