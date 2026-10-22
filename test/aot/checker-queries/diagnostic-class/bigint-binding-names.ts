// To the checker the name `1n` of a binding element is the text `1n`. At run time it is the property `1`.
declare const list: number[];
declare const record: { 1: string; "1n": number; other: boolean };
const { 0n: first } = list;
const { 0: second } = list;
const { 1n: named, ...rest } = record;
const namedText: string = named;
const keptNumber: number = rest[1];
const omitted: { "1n": number } = rest;
function withDefault({ 1n: value = 1 } = {}) {
  return value;
}
withDefault({ "1n": "text" });
withDefault({ "1n": 2 });
export {};
