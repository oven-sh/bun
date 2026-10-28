// `return JSON.parse(text)` in an async function that declares its result is parsed by that type, and answers what plain JSON.parse answers.
// IR+ ^ .* = JSONSourceOpen v
interface Point {
  x: number;
  y: number;
}
interface Message {
  point: Point;
  name: string;
  tags?: string[];
}
async function read(text: string): Promise<Message> {
  return JSON.parse(text);
}
async function show(text: string) {
  try {
    const value: unknown = await read(text);
    const keys = typeof value === "object" && value !== null ? Reflect.ownKeys(value).map(String).join() : typeof value;
    console.log(JSON.stringify(value), keys);
  } catch (error) {
    console.log((error as Error).name + ":", (error as Error).message);
  }
}
const made: Message = { point: { x: 0, y: 0 }, name: "made here" };
console.log(JSON.stringify(made));
for (let round = 0; round < 3; round++) {
  await show('{"point":{"x":3,"y":4},"name":"fits","tags":["a","b"]}');
  await show('{"name":"another order","point":{"y":4.5,"x":-0}}');
  await show(' { "point" : { "x" : 1 , "y" : 2 } , "name" : "中文" , "more" : [ 1 ] } ');
  await show('{"point":5,"name":6}');
  await show('{"point":{"x":"3","y":null},"name":"wrong members"}');
  await show('{"point":{"x":1,"y":2},"name":"twice","name":"the second"}');
  await show('{"then":1,"point":{"x":1,"y":2},"name":"no promise"}');
  await show('{"__proto__":{"x":1},"point":{"x":1,"y":2},"name":"own member"}');
  await show("{}");
  await show("[]");
  await show("null");
  await show("5");
  await show('"text"');
  await show("");
  await show('{"point":{"x":1,"y":2},"name":"cut');
  await show('{"point":{"x":1,"y":2},"name":"more behind it"}x');
}
