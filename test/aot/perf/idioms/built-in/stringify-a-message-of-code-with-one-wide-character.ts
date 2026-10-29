import { nextTurns } from "../host.ts";
let kept: unknown;
const code = 'function greet(name: string): string {\n  const text = "hello, " + name;\n  return text + "!";\n}\n\n';
const messages: { role: string; content: string }[] = [0, 1].map(n => ({ role: "assistant", content: "Here is the function \u2728 number " + n + ":\n\n" + code.repeat(40) }));
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const text = JSON.stringify(messages[i & 1]);
    kept = text;
    s = (s + text.length) | 0;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
