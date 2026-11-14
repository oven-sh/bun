function pick(path: string): string {
  const parts = path.split("/");
  const first = parts[1];
  if (first === "keep") return first + "!";
  if (first === "drop") return "dropped";
  return String(first);
}
console.log(["/keep", "/drop", "/else", "", "/"].map(pick).join(" | "));
