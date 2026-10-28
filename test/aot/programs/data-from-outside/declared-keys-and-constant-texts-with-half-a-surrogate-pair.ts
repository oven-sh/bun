// A declared key, a constant text and a part of a template that hold half a surrogate pair: the compiled parser gives what JSON.parse gives.
type Key = { "\udfaa": number; "a\ud800": string };
type Text = { k: "\ud800" | "a\udc00b" | "😀" };
type Template = { k: `\ud83d${number}` };

function outcome(run: () => unknown): string {
  try {
    return JSON.stringify(run());
  } catch (error: any) {
    return error.name + ": " + JSON.stringify(error.message);
  }
}

for (const text of ['{"\\uDFAA":0,"a\\ud800":"x"}', '{"\\uDFAB":0,"a\\ud800":"x"}', '{"\\uFFFD":0,"a\\uFFFD":"x"}', '{"\\uDFAA":"0","a\\ud800":1}']) {
  console.log(outcome(() => JSON.parse(text) as Key), outcome(() => globalThis.JSON.parse(text)));
}
for (const text of ['{"k":"\\ud800"}', '{"k":"a\\udc00b"}', '{"k":"\\ud83d\\ude00"}', '{"k":"\\ufffd"}', '{"k":"\\ud801"}', '{"k":"\\ud83d"}']) {
  console.log(outcome(() => JSON.parse(text) as Text), outcome(() => globalThis.JSON.parse(text)));
}
for (const text of ['{"k":"\\ud83d5"}', '{"k":"\\ufffd5"}', '{"k":"\\ud83dx"}']) {
  console.log(outcome(() => JSON.parse(text) as Template), outcome(() => globalThis.JSON.parse(text)));
}
