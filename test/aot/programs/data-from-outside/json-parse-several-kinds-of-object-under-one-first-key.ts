// Texts of seven kinds that begin alike: one first key, whose value names the kind. However many of them the parser that expects keys has seen, each is parsed as written.
const kinds = [
  (at: number) => '{"kind":"first","at":' + at + ',"value":{"kind":"inner","text":"abc"}}',
  (at: number) => '{"kind":"second","at":' + at + ',"block":{"kind":"inner","name":"n"}}',
  (at: number) => '{"kind":"third","at":' + at + "}",
  (at: number) => '{"kind":"fourth","note":{"id":"x","role":"r"}}',
  (at: number) => '{"kind":"fifth","value":{"reason":"r","other":null},"usage":{"count":' + at + "}}",
  (at: number) => '{"kind":"sixth"}',
  (at: number) => '{"kind":"seventh","at":' + at + ',"usage":{"count":1},"more":true}',
];
let wrong = 0;
for (let turn = 0; turn < 700; turn++) {
  const text = kinds[turn % 7]!(turn % 10);
  const value: unknown = JSON.parse(text);
  if (JSON.stringify(value) !== text) wrong++;
}
console.log("700 texts,", wrong, "wrong");
