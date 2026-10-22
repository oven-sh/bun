// IR+ ^ .* = JSONSourceOpen v
interface Numbered { b: string; 1: string; a: string; "0": number; "01": number; "-1": number; "4294967295": number; "1.5": number }
interface Flat { id: number; name: string }
const made: [Numbered, Flat] = [{ b: "", 1: "", a: "", "0": 0, "01": 0, "-1": 0, "4294967295": 0, "1.5": 0 }, { id: 0, name: "made here" }];
console.log(JSON.stringify(made));
function show(label: string, work: () => unknown) {
  try {
    const value = work() as any;
    const own = value !== null && typeof value === "object" ? Reflect.ownKeys(value).map(String).join() : "";
    console.log(label + ":", JSON.stringify(value), own);
  } catch (error) {
    console.log(label + ": threw", (error as Error).name + ":", (error as Error).message);
  }
}
const numbered = '{"b":"x","1":"y","a":"z","0":5,"01":6,"-1":7,"4294967295":8,"1.5":9}';
show("declared numeric keys", () => JSON.parse(numbered) as Numbered);
show("read by index", () => { const value = JSON.parse(numbered) as Numbered; return [value[1], value["0"], (value as any)[0], (value as any)["1"], Object.keys(value).length, 1 in value, "0" in value, Object.getOwnPropertyDescriptor(value, "1")]; });
show("a mark before the text", () => JSON.parse('﻿{"id":1,"name":"n"}') as Flat);
show("a mark after the brace", () => JSON.parse('{﻿"id":1,"name":"n"}') as Flat);
show("a mark at the end", () => JSON.parse('{"id":1,"name":"n"}﻿') as Flat);
show("y with dots before the text", () => JSON.parse('ÿ{"id":1,"name":"n"}') as Flat);
show("y with dots at the end", () => JSON.parse('{"id":1,"name":"n"}ÿ') as Flat);
show("a wide character at the end", () => JSON.parse('{"id":1,"name":"n"}中') as Flat);
show("a zero character at the end", () => JSON.parse('{"id":1,"name":"n"}\u0000') as Flat);
show("a zero character in the middle", () => JSON.parse('{"id":1,\u0000"name":"n"}') as Flat);
show("a zero character in a string", () => JSON.parse('{"id":1,"name":"n\u0000"}') as Flat);
show("other spaces at the end", () => JSON.parse('{"id":1,"name":"n"} ') as Flat);
show("line ends at the end", () => JSON.parse('{"id":1,"name":"n"}\r\n\t ') as Flat);
show("a vertical tab at the end", () => JSON.parse('{"id":1,"name":"n"}\u000b') as Flat);
