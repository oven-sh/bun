// Flags: --drop=console
// Reference: bun build --compile
let evaluated = 0;
const say = (text: unknown) => void process.stdout.write(String(text) + "\n");
console.log("dropped", evaluated++);
console.error.call(console, evaluated++);
console?.warn(evaluated++);
(console as any).info(evaluated++);
say(console.log("its value", evaluated++));
say(evaluated);
function shadows(console: { log(text: string): string }) {
  return console.log("a parameter by the name is called");
}
say(shadows({ log: text => text }));
{
  const console = { log: (text: string) => "so is a constant: " + text };
  say(console.log("called"));
}
say(typeof console.log);
const held = console;
held.table = () => say("through another name it is called");
held.table();
say((console as any).log("as a test") ? "never" : "the arm for undefined");
import("./other").then(other => other.run());
