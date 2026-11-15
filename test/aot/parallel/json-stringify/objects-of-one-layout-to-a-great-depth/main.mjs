// One serializer a layout calls itself for each level. At one level more than the engine admits the call throws, on every machine, and the next call writes a whole text.
function chain(depth) { let tree = { v: 0 }; for (let v = 1; v <= depth; ++v) tree = { v, next: tree }; return tree; }
function attempt(value) { try { return JSON.stringify(value).length; } catch (error) { return error.constructor.name + ": " + error.message; } }
for (const depth of [0, 1, 63, 64, 65, 1000, 39998, 39999, 40000, 40001, 3]) console.log(depth, attempt(chain(depth)));
