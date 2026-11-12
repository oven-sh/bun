// RUN: lower
// DIAGNOSTIC: TS100150 main.ts:1

// FILE: main.ts
import gone from "./gone.bin" with { type: "file" };
console.log(gone);

// FILE: settings.conf
{ "port": 8080, "hosts": ["a", "b"] }

// FILE: note.tpl
hello
