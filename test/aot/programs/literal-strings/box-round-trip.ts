// A literal-string value keeps its identity through fields, untyped calls, keys and concatenation.
declare const console: { log(...values: unknown[]): void };
type Method = "get" | "post" | undefined;
type Verb = "get" | "post" | "trace";
class Request {
  method: Method;
  constructor(method: Method) {
    this.method = method;
  }
}
const table: Record<string, number> = { get: 1, post: 2, undefined: 3 };
function untyped(value: any): any {
  return value;
}
function read(request: Request): Method {
  return request.method;
}
function roundTrip(method: Method): string {
  const returned = untyped(read(new Request(method))) as Method;
  return [returned === method, returned === "get", table[returned as string], "<" + returned + ">"].join(" ");
}
console.log(roundTrip("get"));
console.log(roundTrip("post"));
console.log(roundTrip(undefined));
function spelled(parts: string[]): any {
  return parts.join("");
}
function accept(verb: Verb): Verb {
  return verb;
}
const spelledVerb = accept(spelled(["tr", "ace"]));
console.log(spelledVerb, spelledVerb.length, untyped(spelledVerb) === spelled(["tr", "ace"]), "<" + spelledVerb + ">");
function requireMethod(method: Method): string {
  return "accepted " + method;
}
const untypedCaller = untyped(requireMethod);
console.log(untypedCaller("get"));
console.log(untypedCaller(undefined));
try {
  console.log(untypedCaller("put"));
} catch (error) {
  console.log(error instanceof TypeError ? "TypeError" : "other");
}
