// Text run by Function and by an indirect eval sees the global scope and what it is handed, and no binding of a module.
const text = (source: string) => (process.argv.length > 99 ? "" : source);
{
  (globalThis as any).counter = 1;
  const bump = new Function(text("counter = counter + 41; return counter;"));
  console.log(bump(), (globalThis as any).counter);
}
{
  const twice = (x: number) => x * 2;
  const apply = new Function("f", "x", text("return f(x) + 1;"));
  console.log(apply(twice, 20));
}
{
  const make = new Function("start", text("let n = start; return () => ++n;"));
  const next = make(5);
  console.log(next(), next());
}
{
  const secret = 7;
  function hidden() {
    return secret;
  }
  let name = "";
  try {
    new Function(text("return secret + hidden();"))();
  } catch (error) {
    name = (error as Error).name;
  }
  console.log(name, hidden());
}
{
  function template(source: string) {
    const body = "with (obj) { return `" + source.replace(/<%=(.+?)%>/g, "${$1}") + "`; }";
    try {
      return new Function("obj", text(body)) as (obj: object) => string;
    } catch {
      throw new Error("bad template");
    }
  }
  console.log(template("hello <%= name %>, <%= count + 1 %>")({ name: "world", count: 1 }));
  let message = "";
  try {
    template("<%= ( %>");
  } catch (error) {
    message = (error as Error).message;
  }
  console.log(message);
}
{
  function allowsEval() {
    try {
      new Function("");
      return true;
    } catch {
      return false;
    }
  }
  class Doc {
    lines: string[] = [];
    write(line: string) {
      this.lines.push(line);
    }
    compile() {
      const F = Function;
      return new F("input", text(this.lines.join("\n")));
    }
  }
  const doc = new Doc();
  doc.write("const out = {};");
  doc.write("out.a = input.a + 1;");
  doc.write("return out;");
  console.log(allowsEval(), JSON.stringify(doc.compile()({ a: 1 })));
}
{
  var $Function = Function;
  function getEvalledConstructor(expressionSyntax: string) {
    try {
      return $Function(text('"use strict"; return (' + expressionSyntax + ").constructor;"))();
    } catch {}
  }
  console.log(getEvalledConstructor("async function () {}")?.name, getEvalledConstructor("function* () {}")?.name);
}
{
  const found = function () {}.constructor as FunctionConstructor;
  console.log(found("a", "b", text("return a * b;"))(6, 7));
}
{
  console.log((0, eval)(text("var made = 5; made + 1")), (globalThis as any).made);
}
