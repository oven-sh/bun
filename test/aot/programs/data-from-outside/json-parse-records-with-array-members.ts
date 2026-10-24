// JSON.parse(text) claimed as a record with array members: the arrays have parsers of their own, and a row, an array or a member that does not fit its type is plain data. What fits is read through its types, what does not is looked at as `unknown`, and changing the arrays afterwards gives what plain Bun gives.
// STATISTIC: ParsersCreated >= 5
type Row = { id: number; tags: string[] };
type Page = { items: Row[]; grid: number[][]; total: number };
type Changed = { list: number[]; name: string };

function read(page: Page): string {
  let text = "total " + page.total;
  const items = page.items;
  if (!items) return text + ", items " + items;
  text += ", " + items.length + " items";
  for (const row of items) text += " [" + row.id + ":" + (row.tags ? row.tags.join("+") : row.tags) + "]";
  for (let at = 0; at < items.length; at++) text += " " + items[at]!.id;
  const grid = page.grid;
  if (!grid) return text + ", grid " + grid;
  let sum = 0;
  for (const line of grid) for (const cell of line) sum += cell;
  return text + ", grid sum " + sum + ", past the end " + items[items.length] + " " + grid[grid.length] + ", ids " + items.map(row => row.id).join();
}

function describe(value: unknown): string {
  if (typeof value !== "object" || value === null) return JSON.stringify(value) ?? "undefined";
  const isArray = Array.isArray(value);
  const members = Reflect.ownKeys(value).map(key => String(key) + "=" + describe((value as any)[key]));
  return (isArray ? "[" : "{") + members.join() + (isArray ? "]" : "}") + (Object.getPrototypeOf(value) === (isArray ? Array.prototype : Object.prototype) ? "" : " ANOTHER PROTOTYPE");
}

for (const text of [
  '{"items":[{"id":1,"tags":["a","b"]},{"id":2,"tags":[]}],"grid":[[1,2],[3]],"total":2}',
  '{"items":[],"grid":[],"total":0}',
  '{ "total": 1, "grid": [ [ ] ], "items": [ { "tags": [ "c" ], "id": 3 } ] }',
  '{"items":[{"id":4}],"grid":[[1.5,-0,1e3]],"total":1}',
  '{"items":null,"grid":null,"total":0}',
  '{"grid":[[1]],"total":0}',
  '{"items":[],"total":0}',
  '{"items":[{"id":10,"tags":[]}],"items":[{"id":11,"tags":["g"]}],"grid":[],"total":1}',
  '{"items":[{"id":12,"tags":[],"more":[1]}],"grid":[],"total":1,"extra":[{"id":13}]}',
]) {
  const page = JSON.parse(text) as Page;
  console.log(read(page));
  console.log(describe(page));
}

for (const text of [
  '{"items":[1,{"id":4,"tags":["d"]},"row",null,[5],true],"grid":[[1]],"total":6}',
  '{"items":[{"id":"six","tags":"none"},{"id":7},{}],"grid":[[1]],"total":3}',
  '{"items":[{"id":8,"tags":[1,null,["e"],{"f":1}]}],"grid":[[1]],"total":1}',
  '{"items":[],"grid":[[1,"two",null,[3],{"four":4}],"line",5,null,{"six":6}],"total":0}',
  '{"items":"none","grid":[],"total":0}',
  '{"items":{"length":1,"0":{"id":9,"tags":[]}},"grid":[],"total":0}',
  '{"items":[],"grid":7,"total":"many"}',
]) {
  console.log(describe(JSON.parse(text) as Page));
}

const rows = Array.from({ length: 300 }, (_, at) => (at === 150 ? "null" : '{"id":' + at + ',"tags":["t' + at + '"]}'));
const many = JSON.parse('{"items":[' + rows.join() + '],"grid":[],"total":300}') as Page;
console.log(many.items.length, many.items[149]!.id, many.items[150], many.items[151]!.tags[0], many.items.reduce((sum, row) => sum + (row ? row.id : 0), 0));

function change(value: Changed, step: number): string {
  const list = value.list as any;
  switch (step) {
    case 0:
      list.push(4, 5);
      break;
    case 1:
      list.length = 1;
      break;
    case 2:
      list[5] = 6;
      break;
    case 3:
      list.named = true;
      break;
    case 4:
      Object.setPrototypeOf(list, { join: () => "another prototype" });
      break;
    case 5:
      Object.freeze(list);
      break;
    case 6:
      Object.defineProperty(list, "0", { get: () => 100 });
      break;
    case 7:
      delete list[1];
      break;
    case 8:
      value.list = [9];
      break;
  }
  let cells = "";
  const after = value.list;
  for (let at = 0; at < after.length; at++) cells += "|" + after[at];
  return step + ": " + cells + " " + after.length + " " + after.join("-") + " " + Reflect.ownKeys(after).map(String).join() + " " + Array.isArray(after);
}
for (let step = 0; step < 10; step++) console.log(change(JSON.parse('{"list":[1,2,3],"name":"n"}') as Changed, step));

for (const text of ['{"items":[{"id":1,"tags":[]}],"grid":[[1],"total":1}', '{"items":[{"id":1,"tags":[]},],"grid":[],"total":1}', '{"items":[', '{"items":[]]}']) {
  try {
    console.log("NO ERROR", describe(JSON.parse(text) as Page));
  } catch (error) {
    console.log((error as Error).name, (error as Error).message);
  }
}
