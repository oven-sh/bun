// RUN: lower
// DIAGNOSTIC: TS2322 main.ts:2

// FILE: main.ts
import settings from "./settings.conf" with { type: "json" };
const port: string = settings.port;
console.log(port);

// FILE: settings.conf
{ "port": 8080, "hosts": ["a", "b"] }

// FILE: note.tpl
hello
