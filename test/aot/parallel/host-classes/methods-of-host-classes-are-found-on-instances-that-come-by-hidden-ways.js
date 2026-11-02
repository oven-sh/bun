// An instance of a host class reaches a call under a written name by a way that hides what it is: out of a getter, a bound function, Reflect.apply, a Map, a callback of the host.
const ways = {
  get getter() {
    return Buffer.from("getter");
  },
  bound: Buffer.from.bind(Buffer, "bound"),
  applied: () => Reflect.apply(Buffer.from, Buffer, ["applied"]),
  mapped: new Map([["key", Buffer.from("mapped")]]),
  constructed: () => Reflect.construct(URL, ["https://example.com/a/b?c=d#e"]),
  listed: () => new Headers([["x-one", "1"], ["x-two", "2"]]),
};
function hide(value) {
  const holders = [{ held: value }, { held: null }, { held: 1 }];
  return holders[Number(String(Date.now()).length > 100)].held;
}
function hex(value) {
  return value.toString("hex") + " " + value.readUInt8(0) + " " + value.subarray(1, 3).toString("latin1") + " " + value.equals(value) + " " + value.indexOf(value[1]);
}
console.log(hex(hide(ways.getter)));
console.log(hex(hide(ways.bound())));
console.log(hex(hide(ways.applied())));
console.log(hex(hide(ways.mapped.get("key"))));

const address = hide(ways.constructed());
console.log(address.toJSON(), address.searchParams.get("c"), [...address.searchParams.keys()].join(), address.toString().length);
const headers = hide(ways.listed());
const step = hide(headers.entries());
console.log(step.next().value.join(), step.next().value.join(), step.next().done, headers.has("x-two"), headers.get("x-one"));

const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(Buffer.from("chunk"));
    controller.close();
  },
});
const chunks = [];
for await (const chunk of stream) chunks.push(hide(chunk).toString("base64"), hide(chunk).readUInt16BE(0));
console.log(chunks.join());
console.log(String(hide(ways.getter)), JSON.stringify(hide(ways.bound())), hide(ways.getter));
