// An enum member whose initializer reads a variable or an ambient enum is evaluated where the enum is created, as in plain Bun: its reverse key and the next implicit value follow from that.
declare const console: { log(...values: unknown[]): void };
function row(label: string, value: object) {
  console.log(label + ": " + Object.keys(value).map(key => key + "=" + String((value as any)[key])).join());
}

const base = 5;
const word = "w";
enum FromNumber { A = base, B }
row("a number", FromNumber);
enum FromArithmetic { A = base * 2 + 1, B, C = 1, D }
row("arithmetic", FromArithmetic);
enum FromString { A = word }
row("a string", FromString);
enum FromTemplate { A = `${word}-a`, B = `${word}` }
row("a template", FromTemplate);
enum FromConcatenation { A = word + "-a", B = "a-" + word, C = word + word }
row("a concatenation", FromConcatenation);

enum Local { S = "s", N = 2 }
enum FromLocalEnum { A = Local.S, B = Local.N, C, D = Local.S + word, E = Local.N + base, F }
row("an enum of this file", FromLocalEnum);
enum FromOwnMember { A = "a", B = A + word, C = base, D = C }
row("its own members", FromOwnMember);

declare enum Host { A = 1 }
(globalThis as any).Host = { A: 20 };
enum FromAmbientEnum { B = Host.A, C }
row("an ambient enum", FromAmbientEnum);
declare const hostNumber = 5;
(globalThis as any).hostNumber = 50;
enum FromAmbientConstant { A = hostNumber, B }
row("an ambient constant", FromAmbientConstant);

function inFunction() {
  const inner = 3;
  enum Inner { A = inner, B }
  return Inner;
}
row("in a function", inFunction());
