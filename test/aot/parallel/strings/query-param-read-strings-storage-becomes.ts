// A string that is looked up as a property key takes the storage of the equal key that is there, of either width. Query parameters are asked by a part of it, and are read from it on both sides of the lookup.
const keys: Record<string, number> = {};
const in16Bits = (text: string): string => Buffer.from(text, "utf16le").toString("utf16le");
const in8Bits = (text: string): string => Buffer.from(text, "latin1").toString("latin1");
function becomes16Bit(text: string): string {
  keys[in16Bits(text)] = 1;
  return in8Bits(text);
}
function lookUp(text: string): void {
  if (keys[text] !== 1) console.log("no key " + text);
}
function ask(text: string, name: string): string {
  const q = new URLSearchParams(text);
  return q.get(name) + "|" + q.has(name) + "|" + q.size;
}
function listLater(text: string, whole: string): string {
  const q = new URLSearchParams(text);
  const size = q.size;
  lookUp(whole);
  let all = size + ":";
  for (const [key, value] of q) all += key + "=" + value + ";";
  return all;
}
function keysLater(text: string, whole: string): string {
  const q = new URLSearchParams(text);
  const size = q.size;
  lookUp(whole);
  return size + ":" + [...q.keys()].join() + ":" + [...q.values()].join();
}
function getLater(text: string, whole: string): string {
  const q = new URLSearchParams(text);
  const first = q.get("bbb");
  lookUp(whole);
  return first + "|" + q.get("bbb") + "|" + q.has("ccc") + "|" + q.toString();
}
for (let round = 0; round < 3; round++) {
  const tag = "r" + round + "x";
  {
    const whole = becomes16Bit("<<aaa|bbb|ccc|" + tag + ">>");
    const names = [0, 1, 2].map(i => whole.slice(2 + 4 * i, 5 + 4 * i));
    lookUp(whole);
    console.log("name", names.map(name => ask(in8Bits("aaa=1&bbb=22&ccc=333&" + tag + "=4"), name)).join(" "));
  }
  for (const later of [listLater, keysLater, getLater]) {
    const whole = becomes16Bit("<<aaa=1&bbb=22&ccc=333&" + tag + later.name + "=4>>");
    console.log(later.name, later(whole.slice(2, -2), whole));
    const flat = becomes16Bit("aaa=1&bbb=22&ccc=333&flat" + tag + later.name + "=4");
    console.log(later.name, "flat", later(flat, flat));
  }
}
