// Texts of seven kinds that begin alike: one first key, whose value names the kind. The parser that expects keys learns them all and goes on serving them.
declare const aotOperationCount: (name: string) => number;
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
console.log("700 texts,", aotOperationCount("jsonParsedWithLearnedShapes"), "by expecting keys, set aside", aotOperationCount("jsonBeginningSetAside"), "times,", aotOperationCount("jsonObjectParsedMemberByMember"), "objects filled member by member,", wrong, "wrong");
