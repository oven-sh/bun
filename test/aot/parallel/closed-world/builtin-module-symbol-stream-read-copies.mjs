// A stream of node:fs keeps the module under a symbol. The program finds the symbol by listing keys and reads the module on the stream, on copies of it and on an object below it.
import { createReadStream, existsSync } from "node:fs";
const stream = createReadStream(process.execPath, { end: 0 });
const find = object => Object.getOwnPropertySymbols(object).find(symbol => symbol.description === "kFs");
const show = (label, held) =>
  console.log(
    label,
    typeof held,
    held === undefined ? "-" : held.existsSync === existsSync,
    held === stream[find(stream)],
    held ? "truthy" : "falsy",
    held == null,
    held instanceof Object,
  );
const spread = { ...stream };
show("spread", spread[find(spread)]);
const assigned = Object.assign({}, stream);
show("assigned", assigned[find(assigned)]);
show("descriptor", Object.getOwnPropertyDescriptor(stream, find(stream)).value);
show("descriptors", Object.getOwnPropertyDescriptors(stream)[find(stream)].value);
const defined = Object.defineProperties({}, Object.getOwnPropertyDescriptors(stream));
show("defined", defined[find(defined)]);
const below = Object.create(stream);
show("below", below[find(stream)]);
show("reflect", Reflect.get(stream, find(stream)));
const { [find(stream)]: taken } = stream;
show("destructured", taken);
for (const key of Reflect.ownKeys(stream))
  if (typeof key === "symbol" && key.description === "kFs") show("own keys", stream[key]);
console.log(find(stream) in stream, Object.hasOwn(stream, find(stream)), delete spread[find(spread)], find(spread));
stream.destroy();
