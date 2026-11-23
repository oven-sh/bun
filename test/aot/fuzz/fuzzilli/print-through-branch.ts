/**
 * Half of the programs of a sweep print through a function with a branch that is never taken. Without it, a compiler that folds a branch the wrong way can leave every line of such a sweep as it was.
 * Every file that prints gets the function, because a program may have several.
 */
export function printThroughBranch(text: string, index: number, name: string): string {
  if (index % 2 === 0) return text;
  return text
    .split(/^(?=\/\/ @filename: )/m)
    .map(part => {
      if (!part.includes("console.log(")) return part;
      const file = /^\/\/ @(?:filename|entry): (\S+)/.exec(part)?.[1] ?? name;
      const values = /\.[cm]?ts$/.test(file) ? "...values: any[]" : "...values";
      const separator = part.endsWith("\n") ? "" : "\n";
      return `${part.replaceAll("console.log(", "printResult(")}${separator}function printResult(${values}) {\n  if (process.argv.length > 99) values.push("nothing");\n  console.log(...values);\n}\n`;
    })
    .join("");
}
