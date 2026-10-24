// The direct call of a native function is made only while the callee is that function: a program that puts something else in its place gets what it put there.
// STATISTIC: NativeFunctionTestsEmitted >= 1
import path from "node:path";
function report(name: string, probe: () => unknown) {
  let answer: unknown;
  try {
    answer = probe();
  } catch (error) {
    answer = (error as Error).name;
  }
  console.log(name, JSON.stringify(answer));
}
function measure(value: string) {
  return [path.isAbsolute(value), path.join(value, "x")];
}
report("before", () => measure("/a"));
const original = path.join;
(path as any).join = (...parts: string[]) => "mine:" + parts.join("|");
(path as any).isAbsolute = undefined;
report("after", () => measure("/a"));
(path as any).isAbsolute = path.win32.isAbsolute;
(path as any).join = original;
report("the other flavor in the place", () => [measure("C:\\a"), measure("/a")]);
