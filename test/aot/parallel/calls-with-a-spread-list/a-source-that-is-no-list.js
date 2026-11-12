// `list.push(a, ...other)`: a proxy round a list, a set, a map, a text, a generator, arguments, a typed array, an object with an iterator; what is no iterable throws and the receiver stays as it was.
const said = [];
function gather(source) { const out = ["w"]; try { out.push("a", ...source); } catch (error) { out.push("threw " + error.name); } return out; }
function* made() { yield 1; yield 2; }
function ofArguments() { return gather(arguments); }
const proxy = new Proxy([1, 2], { get(target, key, receiver) { said.push(String(key)); return Reflect.get(target, key, receiver); } });
for (const source of [proxy, new Set([1, 2]), new Map([[1, 2]]), "ab", made(), new Uint8Array([1, 2]), { [Symbol.iterator]: made }, 5, null, undefined, {}]) console.log(JSON.stringify(gather(source)));
console.log(JSON.stringify(ofArguments(1, 2)), said.join(","));
