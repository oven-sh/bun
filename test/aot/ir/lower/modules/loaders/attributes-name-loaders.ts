// RUN: lower

// What the loader that the attribute names makes of the file says the type of the import.

// FILE: main.ts
import settings from "./settings.conf" with { type: "json" };
import note from "./note.tpl" with { type: "text" };
const port: number = settings.port;
console.log(port + 1, settings.hosts.map(host => host.length).join(), note.trim());

// FILE: settings.conf
{ "port": 8080, "hosts": ["a", "b"] }

// FILE: note.tpl
hello
