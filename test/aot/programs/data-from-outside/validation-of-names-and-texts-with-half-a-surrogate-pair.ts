// A declared key, a constant text, a part of a template and a pattern that hold half a surrogate pair: compiled and interpreted validators know them alike.
import { validate } from "bun:bundle";
import type { Schema } from "bun";

type Key = { "\udfaa": number; "a\ud800": string };
type Text = { k: "\ud800" | "a\udc00b" | "😀" };
type Template = { k: `\ud83d${number}` };
type Pattern = { k: string & Schema.Pattern<"^\udc00+$"> };

function outcome(run: () => unknown): string {
  try {
    return JSON.stringify(run());
  } catch (error: any) {
    return error.name + ": " + JSON.stringify(error.message) + " " + JSON.stringify(error.issues ?? null);
  }
}

for (const text of ['{"\\uDFAA":0,"a\\ud800":"x"}', '{"\\uDFAB":0,"a\\ud800":"x"}', '{"\\uFFFD":0,"a\\uFFFD":"x"}', '{"\\uDFAA":"0","a\\ud800":1}']) {
  console.log(outcome(() => JSON.parse<Key>(text)), outcome(() => validate<Key>(JSON.parse(text))));
}
for (const text of ['{"k":"\\ud800"}', '{"k":"a\\udc00b"}', '{"k":"\\ud83d\\ude00"}', '{"k":"\\ufffd"}', '{"k":"\\ud801"}', '{"k":"\\ud83d"}']) {
  console.log(outcome(() => JSON.parse<Text>(text)), outcome(() => validate<Text>(JSON.parse(text))));
}
for (const text of ['{"k":"\\ud83d5"}', '{"k":"\\ufffd5"}', '{"k":"\\ud83dx"}']) {
  console.log(outcome(() => JSON.parse<Template>(text)), outcome(() => validate<Template>(JSON.parse(text))));
}
for (const text of ['{"k":"\\udc00\\udc00"}', '{"k":"\\ufffd"}', '{"k":""}']) {
  console.log(outcome(() => JSON.parse<Pattern>(text)), outcome(() => validate<Pattern>(JSON.parse(text))));
}
