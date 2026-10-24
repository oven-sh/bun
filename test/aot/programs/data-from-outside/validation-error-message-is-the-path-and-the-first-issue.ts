// The message of the TypeError of a failed validation is the path of the first issue, a space and the message of that issue. Where there is no path it says "value".
// Words that the program wrote itself come first, whatever they begin with, and the path follows them in parentheses.
// Compiled code calls the functions of the validation library without importing it, so nothing evaluates the library's top level.
// IR= 0 formatPath GetModuleVariable
import { JSON, type Schema } from "bun";
function messagesOf(parse: () => unknown): string {
  try {
    return "accepted " + JSON.stringify(parse());
  } catch (error: any) {
    return error.message + " | " + error.issues[0].message;
  }
}
console.log(messagesOf(() => JSON.parse<{ n: number }>('{"n":"1"}')));
console.log(messagesOf(() => JSON.parse<number>('"1"')));
console.log(messagesOf(() => JSON.parse<number[]>('["1"]')));
console.log(messagesOf(() => JSON.parse<{ "a-b": { c: number }[] }>('{"a-b":[{"c":"1"}]}')));
console.log(messagesOf(() => JSON.parse<{ n: number; m: number }>('{"n":"1"}')));
console.log(messagesOf(() => JSON.parse<{ n: number & Schema.Min<1> }>('{"n":0}')));
console.log(messagesOf(() => JSON.parse<{ n: number & Schema.Max<1> }>('{"n":2}')));
console.log(messagesOf(() => JSON.parse<{ s: string & Schema.MinLength<2> }>('{"s":"b"}')));
console.log(messagesOf(() => JSON.parse<{ s: string[] & Schema.MaxItems<1> }>('{"s":["a","b"]}')));
console.log(messagesOf(() => JSON.parse<{ s: string & Schema.Pattern<"^a+$"> }>('{"s":"b"}')));
console.log(messagesOf(() => JSON.parse<{ s: string & Schema.Format<"email"> }>('{"s":"b"}')));
console.log(messagesOf(() => JSON.parse<{ n: number & Schema.MultipleOf<2> }>('{"n":3}')));
console.log(messagesOf(() => JSON.parse<{ n: number & Schema.Message<"my own words"> }>('{"n":"1"}')));
console.log(messagesOf(() => JSON.parse<{ n: number & Schema.Message<"must be my own words"> }>('{"n":"1"}')));
console.log(messagesOf(() => JSON.parse<{ n: number & Schema.Message<"n: my own words"> }>('{"n":"1"}')));
console.log(messagesOf(() => JSON.parse<{ n: number & Schema.Message<"my own words">; m: number }>('{"n":"1"}')));
console.log(messagesOf(() => JSON.parse<{ a: number } & Schema.Strict>('{"a":1,"b":2}')));
console.log(messagesOf(() => JSON.parse<{ o: { a: number } & Schema.Strict }>('{"o":{"a":1,"b":2}}')));
console.log(messagesOf(() => JSON.parse<{ a: number } & Schema.Strict & Schema.Message<"my own words">>('{"a":1,"b":2}')));
console.log(messagesOf(() => JSON.parse<{ a: number } & Schema.Strict & Schema.Message<"my own words">>('{"a":1,"b":2,"c":3}')));
console.log(messagesOf(() => JSON.parse<{ n: number }>('{"n":1}')));
