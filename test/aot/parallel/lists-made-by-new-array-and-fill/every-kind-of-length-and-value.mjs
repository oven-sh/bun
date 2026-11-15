function tell(make) { try { const list = make(); return JSON.stringify(list) + " " + list.length + " " + Array.isArray(list) + " " + Object.keys(list).length; } catch (error) { return error.constructor.name; } }
const given = JSON.parse('{"sizes":[0,1,3,2.5,-1,4294967295,4294967296,"3","x",null,true,[2],{"length":2}],"values":[0,-0,1.5,"a",null,[1],{"k":1}]}');
for (const size of given.sizes) console.log(JSON.stringify(size), size === 4294967295 ? "skipped" : tell(() => new Array(size).fill(7)));
for (const value of given.values) console.log(JSON.stringify(value), tell(() => new Array(2).fill(value)));
console.log(tell(() => new Array(undefined).fill(1)), tell(() => new Array(3).fill()), tell(() => Array(3).fill(2)));
const shared = new Array(2).fill({ n: 0 }); shared[0].n++; console.log(shared[1].n, shared[0] === shared[1]);
const same = new Array(3); console.log(same.fill(4) === same);
