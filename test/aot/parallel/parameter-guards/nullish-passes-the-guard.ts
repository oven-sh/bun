// undefined and null pass the guard of a parameter whose type holds references. The fast version then does with them what plain JavaScript does: tests find them, and a member asked of them throws in the same words.
function show(label: string, run: () => unknown) {
  try {
    console.log(label, String(run()));
  } catch (error) {
    console.log(label, "threw", (error as Error).constructor.name, (error as Error).message);
  }
}
class Item {
  id = 1;
  tag = "item";
  inner: Item | undefined = undefined;
  twice() {
    return this.id * 2;
  }
}
const any = (value: unknown): any => value;
function reads(item: Item) {
  const number = item.id + 0;
  const text = item.tag + "";
  return number + text;
}
function stores(item: Item) {
  item.id = 5;
  item.tag = "stored";
  return item.id + item.tag;
}
function calls(item: Item) {
  const doubled = item.twice();
  return doubled + item.id;
}
function testsFirst(item: Item) {
  if (!item) return "nothing: " + item;
  const number = item.id;
  return number + item.tag;
}
function comparesFirst(item: Item) {
  if (item === undefined) return "undefined";
  if (item === null) return "null";
  return item.id + item.tag;
}
function optionalChain(item: Item) {
  const number = item?.id;
  const deep = item?.inner?.id;
  return number + "|" + deep + "|" + (item?.twice() ?? "none");
}
function onOneWay(item: Item, reads: boolean) {
  let answer = "skipped";
  if (reads) answer = item.tag + item.id;
  return answer + "|" + (item == null);
}
function readsInHandler(item: Item) {
  try {
    return item.id + item.tag;
  } catch (error) {
    return "caught " + (error as Error).message + " " + (item == null);
  }
}
function readsBehindEffect(item: Item, log: string[]) {
  log.push("before");
  const number = item.id;
  log.push("after");
  return number;
}
function ofText(text: string) {
  const long = text.length;
  return long + text.toUpperCase() + text.charCodeAt(0);
}
function ofList(list: number[]) {
  const long = list.length;
  return long + ":" + list[0] + ":" + list.join("-");
}
function elementOf(list: number[], at: number) {
  const value = list[at];
  list[at] = value + 1;
  return value + ":" + list[at];
}
function ofComputedKey(item: Item, key: { toString(): string }) {
  return (item as any)[key as any];
}
for (const value of [new Item(), undefined, null, new Item()]) {
  const name = value === undefined ? "undefined" : value === null ? "null" : "item";
  show("reads " + name, () => reads(any(value)));
  show("stores " + name, () => stores(any(value)));
  show("calls " + name, () => calls(any(value)));
  show("testsFirst " + name, () => testsFirst(any(value)));
  show("comparesFirst " + name, () => comparesFirst(any(value)));
  show("optionalChain " + name, () => optionalChain(any(value)));
  show("onOneWay " + name, () => onOneWay(any(value), false) + " " + onOneWay(any(value), true));
  show("readsInHandler " + name, () => readsInHandler(any(value)));
  const log: string[] = [];
  show("readsBehindEffect " + name, () => readsBehindEffect(any(value), log));
  console.log("log", log.join());
  show("computed key " + name, () => ofComputedKey(any(value), { toString() { console.log("key asked"); return "id"; } }));
}
for (const value of ["text", undefined, null, ""]) show("ofText " + value, () => ofText(any(value)));
for (const value of [[1, 2], undefined, null, []]) {
  show("ofList " + value, () => ofList(any(value)));
  show("elementOf " + value, () => elementOf(any(value), 0));
}
