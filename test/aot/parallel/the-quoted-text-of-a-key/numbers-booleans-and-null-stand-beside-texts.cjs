"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const values = JSON.parse('["one", 1, true, null, "true", "null", "1", 1.5, -0, false, "one"]');
for (let turn = 0; turn < 3 + more; turn++) for (let i = 0; i < values.length; i++) { const value = values[i]; if (typeof value !== "object" || value === null) said.push(JSON.stringify(value)); }
console.log(said.join("\n"));
