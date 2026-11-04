// `for (const [key, value] of Object.entries(bag))` makes no list where the bag is known to be a plain object: the iteration takes the call that waited.
// A guess fails in front of the loop where `options` is not what is written.
type Options = { prefix: string };
let ticks = 0;
function tick() { ticks++; }
function parse(text: string) {
  const bag = Object.create(null);
  for (const part of text.split(";")) {
    if (!part) continue;
    const at = part.indexOf("=");
    bag[part.slice(0, at)] = part.slice(at + 1);
  }
  return bag;
}
async function total(options: Options, text: string): Promise<string> {
  tick();
  const prefix = options.prefix;
  let sum = "";
  const bag = parse(text);
  for (const [key, value] of Object.entries(bag)) {
    sum += value;
    await null;
    if (key === "stop") break;
  }
  return prefix + sum;
}
(globalThis as any).total = total;
const odd = { get prefix() { return "got:"; } } as Options;
console.log(await total({ prefix: "sum:" }, "a=1;b=2"), await total(odd, "a=1;stop=5;c=9"), await total(JSON.parse('{"x":1,"prefix":"p:"}'), ""), ticks);
