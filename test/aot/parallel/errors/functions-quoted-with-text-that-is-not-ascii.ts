// An error quotes the call that failed as Bun prints it, with the functions that lie in it. Bun's printer escapes what is not ASCII:
// the build stores such a stretch as "the written text from here, escaped", not byte for byte.
const o: Record<string, any> = { f: 1 };
type Text = string;
const tries: (() => unknown)[] = [
  () => o.nothing(function (a: any) { return a.first("字字xéÿ😀y" + a.second); }),
  () => o.nothing(function (a: Text): Text { return "字字字" + "é" + "😀😀" + `字${a}字` + /字/.source; }),
  () => o.nothing(function (): Record<string, number> { return { "字": 1, é: 2 }; }),
  () => new o.nothing(class { 字(): Text { return "ÿ字" as Text; } }),
  () => o.nothing((): Text => "字".repeat(2) + '字' + "a字b"),
  () => o.nothing(function (a: Text) { return (a as Text) + "字" + (a as Text) + "字字" + o.f; }, function () { return "¡"; }),
  () => o.nothing(function outer() { return function inner(b: Text) { return "内" + b; } }),
];
for (const attempt of tries) {
  try {
    attempt();
  } catch (error) {
    console.log(String((error as Error).message));
  }
}
