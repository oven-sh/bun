// RUN: lower
// DIAGNOSTIC: TS2322 main.ts:2

// FILE: main.ts
import note from "./note.tpl" with { type: "text" };
const size: number = note;
console.log(size);

// FILE: settings.conf
{ "port": 8080, "hosts": ["a", "b"] }

// FILE: note.tpl
hello
