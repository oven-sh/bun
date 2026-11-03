// bun-types adds an overload to JSON.parse. What uses JSON.parse or json() as a type or as a value checks as it does without it, but for a function expression, which writes the types of its parameters.
export const parseWithReviver: typeof JSON.parse = (text: string, reviver?: (this: any, key: string, value: any) => any) => JSON.parse(text, reviver);
const parseText: (text: string) => any = JSON.parse;
const parameters: Parameters<typeof JSON.parse> = ["[1,2]", (_key, value) => value];
function call<F extends (...given: any[]) => any>(f: F, ...given: Parameters<F>): ReturnType<F> {
  return f(...given);
}
function keepBody(response: Response): void {
  const parsed: Promise<unknown> = response.json();
  response.json = () => parsed;
}
function keepRequest(request: Request): void {
  const read: () => Promise<any> = request.json;
  request.json = read;
}
class Answer implements Pick<Response, "json" | "text"> {
  json(): Promise<any> {
    return Promise.resolve({ ok: true });
  }
  text(): Promise<string> {
    return Promise.resolve("{}");
  }
}
const own: Pick<JSON, "parse"> = { parse: (text: string, reviver?: (this: any, key: string, value: any) => any) => [text, typeof reviver] };
type Parsed = ReturnType<typeof JSON.parse>;
const parsed: Parsed = parseWithReviver('{"a":1}');
console.log(parsed.a, parseText("2"), JSON.parse(...parameters).length, call(JSON.parse, "3"), JSON.stringify(own.parse("4")), JSON.stringify(await new Answer().json()), typeof keepBody, typeof keepRequest);
