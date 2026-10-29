function fill(list: any[], from: any[]): void { for (let i = 0; i < from.length; i++) list[i] = from[i]; }
const texts = ["[1.5,2.5,3.5]", "[1,2,3]", "[{},\"a\",null]", "[1,2.5,\"x\"]", "[]", "[1.5,null,3]"];
for (const target of texts) {
  for (const source of texts) {
    const list = JSON.parse(target) as any[];
    const from = JSON.parse(source) as any[];
    fill(list, from);
    list[list.length + 1] = 7;
    list[0] = from;
    console.log(target, source, JSON.stringify(list), list.length);
  }
}
