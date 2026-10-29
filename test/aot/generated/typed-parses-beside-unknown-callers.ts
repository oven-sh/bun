// `JSON.parse(text) as T` and `await body.json() as T` make objects of the declared type. Elsewhere in the program the same built-in goes out of sight:
// it is kept in parsed data and called from there, or the program evaluates text, so the built-in may have been replaced. What is parsed stays what plain Bun parses.

const types = `interface Kid { a: number; b: string; c: number[] }
interface Top { f: number; kid: Kid; list: Kid[]; opt?: string; n: number | null; flag: boolean }
const text = '{"f":9.5,"kid":{"a":1.25,"b":"x","c":[1,2.5]},"list":[{"a":-0,"b":"y","c":[]},{"c":[3],"b":"z","a":1e21}],"n":null,"extra":{"z":1},"flag":true}';
const show = (top: Top) => console.log(JSON.stringify(top), top.f, top.kid.a, top.kid.c[1], Object.is(top.list[0].a, -0), top.list[1].a, top.opt, top.n, top.flag, Object.keys(top).join(), Object.keys(top.list[1]).join());
`;

export const sources: Record<string, { callee: string; parsed: string }> = {
  "JSON.parse": { callee: "JSON.parse", parsed: "JSON.parse(text) as Top" },
  "Response.prototype.json": { callee: "Response.prototype.json", parsed: "(await new Response(text).json()) as Top" },
  "Request.prototype.json": { callee: "Request.prototype.json", parsed: `(await new Request("http://localhost/", { method: "POST", body: text }).json()) as Top` },
  "Blob.prototype.json": { callee: "Blob.prototype.json", parsed: "(await new Blob([text]).json()) as Top" },
};

export const neighbors: Record<string, (callee: string) => { before?: string; behind?: string }> = {
  "nothing else": () => ({}),
  "the built-in is kept in a parsed array": callee => ({ before: `const held: any[] = JSON.parse("[]");\nheld.push(${callee});\nconsole.log(held.length);\n` }),
  "the built-in is called out of a parsed array first": callee => ({
    before: `const held: any[] = JSON.parse("[]");\nheld.push(${callee}, ${callee === "JSON.parse" ? "undefined" : `new ${callee.split(".")[0]}(${callee.startsWith("Request") ? `"http://localhost/", { method: "POST", body: "[1]" }` : callee.startsWith("Blob") ? `["[1]"]` : `"[1]"`})`});\nconsole.log(JSON.stringify(await held[0].call(held[1], "[1]")));\n`,
  }),
  "the built-in is called out of a parsed array afterwards": callee => ({
    behind: `const held: any[] = JSON.parse("[]");\nheld.push(${callee}, ${callee === "JSON.parse" ? "undefined" : `new ${callee.split(".")[0]}(${callee.startsWith("Request") ? `"http://localhost/", { method: "POST", body: "[1]" }` : callee.startsWith("Blob") ? `["[1]"]` : `"[1]"`})`});\nconsole.log(JSON.stringify(await held[0].call(held[1], "[1]")));\n`,
  }),
  "text is evaluated": () => ({ behind: `const never = Date.now() < 0;\nconsole.log(Function("return " + (never ? "x" : "1"))());\n` }),
  "text is evaluated and a realm is made": () => ({
    behind: `const never = Date.now() < 0;\nconsole.log(Function("return " + (never ? "x" : "1"))());\ndeclare const ShadowRealm: any;\nawait new ShadowRealm().importValue("node:path", "sep").then(() => console.log("settled"), () => console.log("settled"));\n`,
  }),
  "what is parsed goes into evaluated text": () => ({ behind: `console.log(new Function("top", "top.f = 'changed'; top.kid.late = 1; delete top.list[0].b; return Object.keys(top.kid).join()")(kept));\nshow(kept);\n` }),
  "what is parsed goes into a parsed array and is changed there": () => ({
    behind: `const held: any[] = JSON.parse("[]");\nheld.push(kept);\nheld[0].f = "changed";\nheld[0].kid.late = 1;\ndelete held[0].list[0].b;\nshow(kept);\n`,
  }),
};

export function textOf(source: { callee: string; parsed: string }, neighbor: { before?: string; behind?: string }) {
  return `${types}${neighbor.before ?? ""}const kept = ${source.parsed};
show(kept);
${neighbor.behind ?? ""}`;
}
