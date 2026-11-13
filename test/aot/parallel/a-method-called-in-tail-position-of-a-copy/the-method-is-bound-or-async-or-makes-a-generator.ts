const other = { name: "other" };
const many = {
  name: "many",
  bound: function (this: { name: string }, more: string) { return this.name + more; }.bind(other),
  async later(more: string) { await null; return this.name + more; },
  *each(more: string) { yield this.name; yield more; },
};
const callBound = (more: string) => many.bound(more);
const callLater = (more: string) => many.later(more);
const callEach = (more: string) => many.each(more);
async function all(more: string): Promise<string> {
  const first = callBound(more);
  const second = await callLater(more);
  const third = [...callEach(more)].join("+");
  return first + " " + second + " " + third;
}
all("!").then(answer => console.log(answer));
console.log("first");
