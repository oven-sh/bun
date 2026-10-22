// Ten kinds of text that begin with the same key, whose value names the kind; together they have more names than one shape holds. They are told apart by more of their beginning, and each kind is served by itself; a kind whose keys are new every time is set aside alone.
function textOf(kind: number, at: number): string {
  let text = '{"kind":"number' + kind + '"';
  for (let member = 0; member < 8; member++) text += ',"k' + kind + "m" + member + '":' + (at + member);
  return text + "}";
}
function measure(label: string, texts: string[]) {
  let wrong = 0;
  for (const text of texts) {
    const value: unknown = JSON.parse(text);
    if (JSON.stringify(value) !== text) wrong++;
  }
  console.log(label + ": " + texts.length + " texts, " + wrong + " wrong");
}
const many = (count: number, make: (at: number) => string) => Array.from({ length: count }, (_, at) => make(at));
measure("ten kinds, the first 200", many(200, at => textOf(at % 10, at)));
measure("ten kinds, the next 1,000", many(1000, at => textOf(at % 10, at)));
measure("nine kinds and one whose keys are new every time", many(1000, at => (at % 10 ? textOf(at % 10, at) : '{"kind":"number0","new' + at + '":1}')));
measure("the nine kinds alone", many(900, at => textOf(1 + (at % 9), at)));
