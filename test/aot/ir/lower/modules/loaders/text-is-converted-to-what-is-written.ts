// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[read]] = GetModuleVariable
// CHECK-NEXT: [[note]] = CheckInitialized [[read]] name="note"
// CHECK-NEXT: = Convert [[note]] declared={type=number}

// Nobody compares the type of the import with the annotation: the program builds, and the text is converted to what is written.

// FILE: main.ts
import note from "./note.tpl" with { type: "text" };
const size: number = note;
console.log(size);

// FILE: settings.conf
{ "port": 8080, "hosts": ["a", "b"] }

// FILE: note.tpl
hello
