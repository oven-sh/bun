function outer() {
  let log = "";
  const t = (s: string) => { log += s; return s; };
  const r = join(t("a"), join(t("b"), t("c")), t("d"));
  return r + ":" + log;
  function join(...parts: string[]): string { log += "(" + parts.length + ")"; return parts.join(""); }
}
function throwing() {
  let log = "";
  try { take(step("x"), fail(), step("y")); } catch (e) { log += "!" + (e as Error).message; }
  return log;
  function step(s: string) { log += s; return s; }
  function fail(): string { throw new Error("stop"); }
  function take(..._: string[]) { log += "taken"; }
}
console.log(outer(), throwing());
