// The TypeError of a failed validation takes its message from the first issue, without that issue's leading "Invalid input: ", "Too small: " and so on.
// Compiled code calls the functions of the validation library without importing it, so nothing evaluates the library's top level: the list of prefixes is a local of the function that reads it.
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
console.log(messagesOf(() => JSON.parse<{ n: number & Schema.Min<1> }>('{"n":0}')));
console.log(messagesOf(() => JSON.parse<{ n: number & Schema.Max<1> }>('{"n":2}')));
console.log(messagesOf(() => JSON.parse<{ s: string & Schema.Pattern<"^a+$"> }>('{"s":"b"}')));
console.log(messagesOf(() => JSON.parse<{ n: number & Schema.MultipleOf<2> }>('{"n":3}')));
console.log(messagesOf(() => JSON.parse<{ n: number & Schema.Message<"my own words"> }>('{"n":"1"}')));
console.log(messagesOf(() => JSON.parse<{ n: number }>('{"n":1}')));
