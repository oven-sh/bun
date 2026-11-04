const told: string[] = [];
const on = (value: any, context: ClassDecoratorContext) => {
  told.push(`${JSON.stringify(value.name)} ${JSON.stringify(context.name)}`);
};
const mark = (_value: any, _context: any) => {};
class Holder {
  accessor Kept = @on class {};
  static accessor Shared = @on class {};
  @mark Marked = @on class {};
  @mark static MarkedAndShared = @on class {};
  @mark accessor Both = @on class {};
  accessor "quoted" = @on class {};
  accessor InParentheses = (@on class {});
  accessor Named = @on class Own {};
  accessor Bare = class {};
  @mark BareAndMarked = class {};
  accessor AFunction = function () {};
}
const held: any = new Holder();
console.log(told.join("\n"));
const names = ["Kept", "Marked", "Both", "quoted", "InParentheses", "Named", "Bare", "BareAndMarked", "AFunction"];
console.log(names.map(name => JSON.stringify(held[name].name)).join(" "));
console.log(JSON.stringify((Holder as any).Shared.name), JSON.stringify((Holder as any).MarkedAndShared.name));
