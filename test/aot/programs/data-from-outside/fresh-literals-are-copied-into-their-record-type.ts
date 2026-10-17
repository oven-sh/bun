declare const aotOperationCount: (name: string) => number;
// An object literal typed any that nothing else holds is copied into the record type of the parameter it is passed to. After the first literal of a shape the copy is made without the runtime.
type Inner = { n: number };
type Message = { id: number; inner: Inner; tags: string[]; title?: string };

function makeInner(n: number): Inner {
  return { n };
}
function typedMessage(): Message {
  return { id: 0, inner: makeInner(0), tags: [] };
}
function stamp(message: Message, id: number): Message {
  message.id += id;
  return message;
}

console.log(JSON.stringify(stamp(typedMessage(), 1)));
const inner = makeInner(7);
const tags = ["x", "y"];
let last: Message = typedMessage();
let sum = 0;
const before = aotOperationCount("operationAOTTypedCoerce");
for (let i = 0; i < 400; i++) {
  const message: any = { id: i, inner, tags };
  last = stamp(message, 1);
  sum += last.id + last.inner.n + last.tags.length;
}
const slow = aotOperationCount("operationAOTTypedCoerce") - before;
console.log(sum, slow < 20 ? "without the runtime" : "through the runtime: " + slow);
console.log(JSON.stringify(last), Object.keys(last).join(), last.inner === inner, last.tags === tags, last.title);
last.title = "late";
console.log(JSON.stringify(last), Object.keys(last).join());
for (const odd of [1.5, 2 ** 31, "text", null, undefined]) {
  try {
    const message: any = { id: odd, inner, tags };
    console.log(JSON.stringify(stamp(message, 1)));
  } catch (e) {
    console.log(e instanceof Error ? e.name + ": " + e.message.split("\n")[0].replace(/ \(bun --aot: [^)]*\)/, "") : String(e));
  }
}
