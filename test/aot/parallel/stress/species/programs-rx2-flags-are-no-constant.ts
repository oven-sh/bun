// Species: programs  flags are no constant. It prints what plain Bun prints.
const log: string[] = [];
class Pattern extends RegExp {
  constructor(source: string, flags?: string) {
    super(source, flags);
    log.push("new " + (typeof source === "string" ? "string" : "other") + " " + Object.prototype.toString.call(source) + " " + flags);
  }
  exec(text: string | number): RegExpExecArray | null {
    log.push("exec " + typeof text + " " + this.lastIndex);
    return super.exec(String(text));
  }
}
const comma = new Pattern(",", process.argv.length > 99 ? "gi" : "g");
log.push("split"); "a,b,c".split(comma);
log.push("matchAll"); [..."a,b,c".matchAll(comma)];
log.push("replace"); "a,b,c".replace(comma, ";");
log.push("match"); "a,b,c".match(comma);
log.push("search"); "a,b,c".search(comma);
log.push("test"); comma.test("x,y");
console.log(log.join("\n"));
