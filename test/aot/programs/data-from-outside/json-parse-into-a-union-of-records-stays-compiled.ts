// JSON.parse(text) without a type argument, passed to a parameter whose type is a union of records: each record keeps its compiled parser. The engine's parser is not asked for the value and no validator runs over it.
// IR- ^ .*JSONParseValue
// IR+ ^ .*JSONParseString
type Change = { action: "add"; ids: string[] } | { action: "remove"; ids: string[] } | { action: "clear" };
type Shape = { center: { x: number; y: number }; radius: number } | { corners: { x: number; y: number }[] } | { label: string };

function apply(current: Set<string>, change: Change): Set<string> {
  switch (change.action) {
    case "add":
      for (const id of change.ids) current.add(id);
      break;
    case "remove":
      for (const id of change.ids) current.delete(id);
      break;
    case "clear":
      current.clear();
  }
  return current;
}

function describe(shape: Shape): string {
  if ("radius" in shape) return "circle at " + shape.center.x + "," + shape.center.y + " of " + shape.radius;
  if ("corners" in shape) return "polygon of " + shape.corners.length + ", first " + shape.corners[0]?.x;
  return "label " + shape.label;
}

const current = new Set<string>();
for (const text of [
  '{"action":"add","ids":["a","b","c"]}',
  '{"action":"remove","ids":["b"]}',
  '{"ids":["d"],"action":"add"}',
  '{ "action": "add", "ids": [ "e" ] }',
  '{"action":"add","ids":["f"],"by":"someone"}',
  '{"action":"remove","ids":[]}',
]) {
  console.log(text, [...apply(current, JSON.parse(text))].join(" "));
}
console.log("cleared", apply(current, JSON.parse('{"action":"clear"}')).size);

for (const text of [
  '{"center":{"x":1,"y":2},"radius":3}',
  '{"corners":[{"x":4,"y":5},{"x":6,"y":7}]}',
  '{"corners":[]}',
  '{"label":"here"}',
  '{"radius":3,"center":{"y":2,"x":1}}',
]) {
  console.log(text, describe(JSON.parse(text)));
}

for (const text of ['{"action":"add","ids":["a"]', '{"action":"add","ids":["a"]}}', ""]) {
  try {
    apply(current, JSON.parse(text));
    console.log("NO ERROR", text);
  } catch (error) {
    console.log((error as Error).name, JSON.stringify(text));
  }
}
