// The toJSON of the first element throws.
const given = JSON.parse(process.argv[2] ?? '[{"a":1,"b":[1,2]},{"a":2},"text",3,null,true,[4,{"c":5}]]');
function make(list) { return { name: "n", list, tail: 1 }; }
function write(holder) { try { return JSON.stringify(holder); } catch (e) { return e.constructor.name + ": " + e.message; } }
const list = [];
list.push({ toJSON() { throw new RangeError('first'); } }); for (const g of given) list.push(g);
const holder = make(list);
globalThis.kept = holder;
for (let i = 0; i < 3; i++) console.log(write(holder));

console.log(write(holder), list.length);
console.log(write(make([])), write(make(["a"])), write(make([1.5])), write(make([1])), write(make([{}])), write(make([[]])), write(make(null)), write(make(undefined)), write(make("no list")));
