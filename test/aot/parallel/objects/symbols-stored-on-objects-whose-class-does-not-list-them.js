// `res[kSocket] = socket`: symbols that are made once, a registered one and a well-known one are stored on instances from outside the class. Whoever lists, copies or asks the objects sees properties like any other.
// Under: --aot-testing=CheckProofsAtRunTime: the types of fields that are appended under symbols
const kSocket = Symbol("kSocket");
const kState = Symbol("kState");
const kShared = Symbol.for("shared.tag");
class Response { constructor(id) { this.id = id; } }
function attach(response, socket) { response[kSocket] = socket; response[kState] = 0; }
function advance(response) { response[kState]++; return response[kState]; }
function share(response, value) { response[kShared] = value; }
function iterate(response, values) { response[Symbol.iterator] = function* () { yield* values; }; }
const lines = [];
function show(o) { return Reflect.ownKeys(o).map(String).join("|"); }
const first = new Response(1);
const second = new Response(2);
attach(first, { port: 80 });
lines.push(show(first), show(second), advance(first), advance(first), String(second[kState]), first[kSocket].port);
share(first, "a"); share(second, 5);
iterate(second, [1, 2, 3]);
lines.push(show(first), show(second), [...second].join(), first[Symbol.for("shared.tag")], typeof second[kShared]);
first.late = true;
lines.push(show(first), JSON.stringify(first), Object.keys(first).join(), show({ ...first }), show(structuredClone({ id: first.id })));
attach(second, null);
second[kState] = "text";
lines.push(advance(second), show(second));
delete first[kSocket];
attach(first, "again");
lines.push(show(first), Object.getOwnPropertySymbols(first).length);
Bun.gc(true);
lines.push(first[kSocket], advance(first), kSocket in second, Object.hasOwn(second, kShared), kState.description);
console.log(lines.join("\n"));
