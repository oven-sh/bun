// Under: --aot-harden=proof-checks,ignore-told-ranges: a net of these words once stood in front of the question for the length of the piece and met the -1, -1 of a group that takes no part: the process stopped at a right program.
function kind(text: string): string {
  const found = /^(\w+)(?:-(\w+))?$/.exec(text);
  if (!found) return "no";
  if (found[2] === "beta") return "beta of " + found[1];
  if (found[1] === "stable") return "stable";
  if (found[2] !== "rc") return "plain";
  return "rc";
}
console.log(["v1", "v2-beta", "stable", "v3-rc", "-"].map(kind).join(" | "));
