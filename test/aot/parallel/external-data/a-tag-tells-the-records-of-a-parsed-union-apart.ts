// A union of records with a tag is parsed by its written type, and the tag stands first, last, twice, escaped, inside a member in front of it, is of another kind, names no arm or is missing; the switch behind the parse goes by what is there.
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a layout that parsers make
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number } | { kind: "none" } | { kind: true; flag: number } | { kind: null; nothing: number };
function load(text: string) { return JSON.parse(text) as Shape; }
function area(shape: Shape) {
  switch (shape.kind) {
    case "circle": return "circle " + shape.r * shape.r;
    case "square": return "square " + shape.side * shape.side;
    case "none": return "none";
    case true: return "flag " + shape.flag;
    case null: return "nothing " + shape.nothing;
    default: return "other " + JSON.stringify(shape);
  }
}
const texts = [
  '{"kind":"circle","r":2}', '{"r":2,"kind":"circle"}', '{"kind":"square","side":3}', '{"side":3,"kind":"square"}', '{"kind":"none"}', '{"kind":true,"flag":4}', '{"flag":4,"kind":true}', '{"kind":null,"nothing":5}',
  '{"kind":"circle","kind":"square","side":6}', '{"kind":"square","side":6,"kind":"circle"}', '{"kind":"\\u0063ircle","r":7}', '{"\\u006bind":"circle","r":7}',
  '{"inner":{"kind":"square"},"kind":"circle","r":8}', '{"text":"\\"kind\\":\\"square\\"","kind":"circle","r":8}', '{"list":[{"kind":"square"}],"r":8,"kind":"circle"}',
  '{"kind":"triangle"}', '{"kind":7}', '{"kind":false,"flag":1}', '{"kind":["circle"],"r":1}', '{"kind":{"kind":"circle"},"r":1}', '{"r":1}', '{}',
  '{"kind":"circle"}', '{"kind":"circle","r":"text"}', '{"kind":"circle","side":1}', '{"kind":"circles","r":1}', '{"kind":"circl","r":1}', '{"kind" : "circle" , "r" : 9}',
];
for (let round = 0; round < 3; round++) {
  for (const text of texts) console.log(area(load(text)));
}
