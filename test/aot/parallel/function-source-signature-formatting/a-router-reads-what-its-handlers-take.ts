type Context = { body: string; headers: Record<string, string>; query: Record<string, string> };
type Handler = (context: Context) => unknown;
function takenBy(handler: Handler): string {
  let text = String(handler);
  if (text.startsWith("async")) text = text.slice(5).trimStart();
  let parameter: string, body: string;
  if (text.charCodeAt(0) === 40) {
    const arrow = text.indexOf("=>", text.indexOf(")"));
    parameter = text.slice(1, text.lastIndexOf(")", arrow));
    body = text.slice(arrow + 2);
  } else if (text.startsWith("function")) {
    parameter = text.slice(text.indexOf("(") + 1, text.indexOf(")"));
    body = text.slice(text.indexOf(")") + 2);
  } else return "not read: " + text.slice(0, 12);
  const names = ["body", "headers", "query"];
  if (parameter.charCodeAt(0) === 123) {
    const listed = parameter.slice(1, -1).split(",").map(name => name.trim());
    return listed.filter(name => names.includes(name)).join() + " of " + listed.length;
  }
  return names.filter(name => body.includes(parameter + "." + name)).join() || "nothing";
}
const routes: Record<string, Handler> = {
  pattern: ({ body }) => "got " + body,
  parenthesized: (c) => "got " + c.body,
  bare: c => "got " + c.body,
  bareCall: c => String(c.body),
  tight: c=>c.body,
  asyncBare: async c => "got " + c.body,
  headersBare: c => "hi " + c.headers["x-name"],
  comment: ({ body /* the text */ }) => "got " + body,
  lines: ({
    body, // the text
    headers,
  }) => "got " + body + " " + headers["x-name"],
  wrapped: (
    { body, query },
  ) => [body, query],
  written: function (c) { return "got " + c.body; },
  query: c => "q " + c.query.name,
  typed: (c: Context): string => c.body,
  typedPattern: ({ body, headers }: { body: string; headers: unknown }) => body,
  cast: (c) => (c as Context).headers,
  notNull: (c?: Context) => c!.body,
};
for (const name in routes) console.log(name, takenBy(routes[name]));
