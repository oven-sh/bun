function kind(text: string): string {
  const found = /^(\w+)(?:-(\w+))?$/.exec(text);
  if (!found) return "no";
  if (found[2] === "beta") return "beta of " + found[1];
  if (found[1] === "stable") return "stable";
  if (found[2] !== "rc") return "plain";
  return "rc";
}
console.log(["stable", "v1-beta", "v1-rc", "v1", "v1-", "stable-rc", "-beta", "stable-beta", "v1-betas"].map(kind).join(" | "));
