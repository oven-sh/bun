// The loop hands every hundredth object to a function that it reads from the global object: an unknown callee.
// In round 2000 the hook gives the prototype of what it was handed a getter and a setter named like the field the loop reads and fills.
interface LinksShape {
  _brand: any;
  flags?: number;
  resolved?: number;
}
const Links = class implements LinksShape {
  declare _brand: any;
};
const log: string[] = [];
let calls = 0;
(globalThis as any).inspect = function (value: object) {
  if (++calls !== 21) return;
  Object.defineProperty(Object.getPrototypeOf(value), ["res", "olved"].join(""), {
    get() {
      return 1000;
    },
    set(value: number) {
      if (log.length < 4) log.push("set " + value);
    },
    configurable: true,
  });
};
function make(flags: number): LinksShape {
  const links = new Links() as LinksShape;
  links.flags = flags;
  return links;
}
function resolve(links: LinksShape): number {
  if (links.resolved === undefined) links.resolved = links.flags! + 1;
  return links.resolved;
}
function run(rounds: number) {
  const inspect: (value: unknown) => void = (globalThis as any).inspect;
  let sum = 0;
  let filled = 0;
  for (let i = 0; i < rounds; i++) {
    const links = make(i & 7);
    sum += links.resolved ?? 0;
    if (i % 100 === 0) inspect(links);
    sum += resolve(links);
    if (Object.hasOwn(links, "resolved")) filled++;
  }
  return `${sum} ${filled}`;
}
const kept = make(1);
const keptFilled = make(2);
resolve(keptFilled);
console.log("run:", run(3000), calls, log.join(", "));
console.log("kept:", kept.resolved, resolve(kept), Object.keys(kept).join(), "|", keptFilled.resolved, resolve(keptFilled), Object.keys(keptFilled).join());
delete (Links.prototype as any).resolved;
console.log("gone again:", kept.resolved, resolve(kept), Object.keys(kept).join());
console.log("run:", run(3000), calls);
