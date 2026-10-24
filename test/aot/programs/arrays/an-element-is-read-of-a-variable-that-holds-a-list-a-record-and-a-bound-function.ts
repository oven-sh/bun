// A module variable holds a filled list, later a record and a bound function. An element of it is read in a closure handed to a function that stores under a computed name into what it reads.
let made: any;
function change(read: () => any, name: string): void {
  const found = read();
  if (found) found[name] = 99;
}
function road(seed: number): string {
  const fresh: any = { a: seed };
  made = new Array(2).fill(fresh);
  change(() => made[1], "a");
  return "" + fresh.a;
}
let answer = "";
for (let turn = 0; turn < 3; turn++) answer = road(turn);
console.log(answer);
made = Object.groupBy([1], () => "k");
made = function (this: any) {
  return this;
}.bind({});
