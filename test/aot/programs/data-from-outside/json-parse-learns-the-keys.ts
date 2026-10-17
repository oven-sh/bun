// JSON.parse without a reviver goes by the keys it has seen at each place, from the second text on that begins with the same eight characters. What stays on that path, which objects are filled member by member, and which values go to the general parser.
declare const aotOperationCount: (name: string) => number;
const names = ["jsonParsedWithLearnedShapes", "jsonObjectParsedMemberByMember", "jsonValueParsedWithoutShape"];
const order = '{"customer":{"id":1,"name":"n"},"items":[{"sku":"a","quantity":2},{"sku":"b","quantity":3}],"coupon":"c"}';
function measure(label: string, text: string, parse: (text: string) => unknown = text => JSON.parse(text), isSeenBefore = true) {
  try {
    if (isSeenBefore) {
      for (let turn = 0; turn < 4; turn++) JSON.parse(order);
      JSON.parse(text);
    }
  } catch {}
  const before = names.map(name => aotOperationCount(name));
  let seen: string;
  try {
    seen = JSON.stringify(parse(text)) === JSON.stringify(JSON.parse(text, (_, held) => held)) ? "right" : "WRONG";
  } catch (error) {
    seen = (error as Error).name;
  }
  const [calls, memberByMember, withoutShape] = names.map((name, at) => aotOperationCount(name) - before[at]!);
  console.log(label + ": calls " + calls + ", objects filled member by member " + memberByMember + ", values without a shape " + withoutShape + ", " + seen);
}
measure("a text that begins as none before", order, undefined, false);
measure("the second that begins so", order, undefined, false);
measure("the third", order, undefined, false);
measure("indented", JSON.stringify(JSON.parse(order), null, 2));
measure("another order of keys", '{"items":[{"quantity":2,"sku":"a"}],"coupon":"c","customer":{"name":"n","id":1}}');
measure("a key is absent", '{"customer":{"id":1},"items":[]}');
measure("a key more", '{"customer":{"id":1,"name":"n","vip":true},"items":[],"coupon":"c","note":"x"}');
measure("another kind of object", '{"title":"t","body":"b","tags":["x","y"]}');
measure("the first kind again", order);
measure("another kind of value at a place", '{"customer":5,"items":{"sku":"a"},"coupon":[1,{"deep":true}]}');
measure("a repeated key", '{"customer":{"id":1,"id":2},"items":[]}');
measure("an escaped key", '{"customer":{"\\u0069d":1},"items":[]}');
measure("a key that is an index", '{"customer":{"0":1},"items":[]}');
measure("__proto__", '{"customer":{"__proto__":1},"items":[]}');
measure("a list at the root", "[" + order + "," + order + "]");
measure("a number", "5");
measure("no JSON", '{"customer":');
measure("an undefined reviver", order, text => JSON.parse(text, undefined));
measure("a reviver", order, text => JSON.parse(text, (_, held) => held));
let dictionary = "{";
for (let i = 0; i < 60; i++) dictionary += (i ? "," : "") + '"key' + i + '":{"value":' + i + ',"name":"n","ok":true,"note":null,"more":[1,2,3],"last":"the last of six"}';
measure("sixty keys", '{"table":' + dictionary + "}}");
measure("sixty keys again", '{"table":' + dictionary + "}}");
measure("sixty other keys", '{"table":' + dictionary.replaceAll("key", "other") + "}}");
