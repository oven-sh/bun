// The parser that expects keys keeps a credit for each beginning of a text. Texts that make it learn again and again, or that are mostly long strings, use the credit up and go straight to the former parser; after a while one more is tried, so a shape that settles late is served again.
function measure(label: string, texts: string[]) {
  let wrong = 0;
  for (const text of texts) {
    const value: unknown = JSON.parse(text);
    if (JSON.stringify(value) !== JSON.stringify(JSON.parse(text, (_, held) => held))) wrong++;
  }
  console.log(label + ": " + texts.length + " texts, " + wrong + " wrong");
}
const many = (count: number, make: (at: number) => string) => Array.from({ length: count }, (_, at) => make(at));
measure("one shape", many(300, at => '{"steady":' + at + ',"name":"n","ok":true}'));
measure("a key that is new every time", many(300, at => '{"always":1,"key' + at + '":' + at + "}"));
measure("the same again", many(300, at => '{"always":1,"key' + at + '":' + at + "}"));
measure("mostly one long string", many(300, at => '{"prose":"' + "word ".repeat(200) + at + '","at":' + at + "}"));
measure("new keys at first", many(100, at => '{"settles":1,"early' + at + '":' + at + "}"));
measure("then one shape, the first 200", many(200, at => '{"settles":1,"late":' + at + "}"));
measure("then one shape, the next 400", many(400, at => '{"settles":1,"late":' + at + "}"));
measure("one shape, still", many(300, at => '{"steady":' + at + ',"name":"n","ok":true}'));
