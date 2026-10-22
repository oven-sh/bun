// Some built-ins answer plain data: objects and arrays of their own making with strings and numbers in them. Each line asks in place what one of the values is,
// so that a compiler that believes it knows the answer prints its belief.
for (const value of Object.values(new Headers({ first: "1" }).toJSON())) console.log("Headers.toJSON, a value is a string:", typeof value === "string");
{ const held = new Headers({ first: "1" }).toJSON(); console.log("Headers.toJSON, a member is a string:", typeof held.first === "string"); }
for (const key in new Headers({ first: "1" }).toJSON()) console.log("Headers.toJSON, a key:", key);
for (const part of new Intl.NumberFormat("en").formatToParts(1.5)) console.log("NumberFormat.formatToParts, members are strings:", typeof part.type === "string", typeof part.value === "string");
for (const part of new Intl.NumberFormat("en").formatToParts(1.5)) for (const value of Object.values(part)) console.log("NumberFormat.formatToParts, a value is a string:", typeof value === "string");
for (const part of new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "UTC" }).formatToParts(0)) for (const value of Object.values(part)) console.log("DateTimeFormat.formatToParts, a value is a string:", typeof value === "string");
for (const part of new Intl.ListFormat("en").formatToParts(["a", "b"])) for (const value of Object.values(part)) console.log("ListFormat.formatToParts, a value is a string:", typeof value === "string");
for (const value of Object.values(new Intl.NumberFormat("en").resolvedOptions()).slice(0, 4)) console.log("NumberFormat.resolvedOptions, a value is an object:", typeof value === "object");
for (const value of Object.values(new Intl.DateTimeFormat("en").resolvedOptions()).slice(0, 3)) console.log("DateTimeFormat.resolvedOptions, a value is a string:", typeof value === "string");
for (const value of Object.values(JSON.parse('{"a":"x"}'))) console.log("JSON.parse, a value is a string:", typeof value === "string");
for (const value of Object.values(new URLSearchParams("a=x").toJSON())) console.log("URLSearchParams.toJSON, a value is a string:", typeof value === "string");
for (const value of Object.values(await new Response('{"a":"x"}').json())) console.log("Response.json, a value is a string:", typeof value === "string");
for (const value of Object.values(structuredClone({ a: "x" }))) console.log("structuredClone, a value is a string:", typeof value === "string");
for (const value of Object.values(process.memoryUsage()).slice(0, 1)) console.log("process.memoryUsage, a value is a number:", typeof value === "number");
for (const value of Object.values(process.versions).slice(0, 1)) console.log("process.versions, a value is a string:", typeof value === "string");
for (const value of Object.values(Bun.TOML.parse('a = "x"'))) console.log("Bun.TOML.parse, a value is a string:", typeof value === "string");
for (const [, value] of Object.entries(new Headers({ first: "1" }).toJSON())) console.log("Headers.toJSON, an entry's value is a string:", typeof value === "string");
console.log("Headers.toJSON, stringified:", JSON.stringify(new Headers({ first: "1" }).toJSON()));
