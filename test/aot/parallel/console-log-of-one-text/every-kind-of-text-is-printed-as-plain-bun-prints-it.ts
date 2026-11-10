// console.log of one operand that is proven a string enters native code by a door of its own, without a frame and a list of arguments: narrow, wide and joined texts, parts of texts, directives that are no directives, groups, long lines, and what is no such call.
// STATISTIC: NativeFunctionsCalledDirectly >= 12
function say(text: string): void {
  console.log(`${text}`);
}
function joined(parts: string[]): void {
  console.log(parts.join(""));
}
function grown(times: number, part: string): string {
  let text = "";
  for (let i = 0; i < times; i++) text += part + i;
  return text;
}
say("plain");
say("");
say("café ÿ\u0080");
say("wide 世界 😀");
say("half \ud83d of a pair");
say("%s %d %o %c %j %%");
say("two\nlines");
say("\u001b[31mred by hand\u001b[0m");
say("tab\tand\0nul");
say(grown(5, "part"));
say(grown(3, "é"));
say(grown(3, "世"));
say(grown(900, "long"));
say("0123456789".substring(2, 7));
say("0123456789".repeat(500));
say(String(12.5));
say(`${1 + 1} of ${[1, 2].length}`);
joined(["a", "b", "c"]);
joined(["é", "世"]);
joined([]);
console.group("outer");
say("one deep");
console.group();
say("still one deep: a group without a label opens nothing");
console.group("inner");
say("two deep\nand its second line");
console.groupEnd();
console.groupEnd();
say("none deep");
console.log("written text");
console.log("a", "b");
console.log(new String("an object"));
console.log(Object("another"));
console.log();
console.log(7);
console.log(undefined);
const maybe: string | number = process.argv.length > 99 ? 1 : "one of two";
console.log(maybe);
console.info("info goes the long way");
console.debug("debug goes the long way");
console.error("an error's text");
console.warn("a warning's text");
console.group("errors in a group");
console.error("caf\u00e9 \u4e16");
console.warn("");
console.groupEnd();
for (const text of ["in", "a", "loop"]) console.log(text);
