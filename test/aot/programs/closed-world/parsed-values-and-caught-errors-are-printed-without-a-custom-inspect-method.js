function make(text) { return JSON.parse(text); }
const parsed = make(process.env.TEXT ?? '{"a":{"b":[1,2,{"c":null}]},"d":"e"}');
console.log(parsed, parsed.a.b[2]);
try { null.x; } catch (error) { console.log(error.code, error.message.length > 0, Object.keys(error)); }
