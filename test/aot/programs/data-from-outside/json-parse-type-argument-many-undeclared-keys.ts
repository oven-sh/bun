type Point = { x: number; y: number };

function undeclaredMembers(prefix: string, count: number): string {
  const members: string[] = [];
  for (let at = 0; at < count; at++) members.push('"' + prefix + at + '":' + at);
  return members.join(",");
}

function compare(label: string, text: string): string {
  const typed = JSON.parse<Point>(text);
  const plain = JSON.parse(text);
  const typedKeys = Object.keys(typed);
  const plainKeys = Object.keys(plain);
  let at = 0;
  while (at < plainKeys.length && typedKeys[at] === plainKeys[at]) at++;
  if (at !== plainKeys.length || typedKeys.length !== plainKeys.length) return label + ": keys differ from place " + at + ": " + typedKeys.slice(at, at + 3).join() + " for " + plainKeys.slice(at, at + 3).join();
  if (JSON.stringify(typed) !== JSON.stringify(plain)) return label + ": written differently";
  return typed.x + typed.y === 3 ? "" : label + ": wrong members";
}

const counts = [1, 2, 31, 32, 33, 63, 64, 65, 127, 128, 129, 130, 131, 132, 133, 200, 513, 1000, 4097, 30000, 32765, 32766, 32767, 32768, 32769, 40000];
let differences = 0;
for (const count of counts) {
  const run = undeclaredMembers("k", count);
  const third = Math.min(count, 20000);
  const texts: [string, string][] = [
    ["in front", "{" + run + ',"x":1,"y":2}'],
    ["between", '{"x":1,' + run + ',"y":2}'],
    ["behind", '{"x":1,"y":2,' + run + "}"],
    ["between and one behind", '{"x":1,' + run + ',"y":2,"m0":0}'],
    ["in front, between and behind", "{" + undeclaredMembers("k", third) + ',"x":1,' + undeclaredMembers("l", third) + ',"y":2,' + undeclaredMembers("m", third) + "}"],
    ["one in front, between", '{"a":0,"x":1,' + run + ',"y":2}'],
  ];
  for (const [label, text] of texts) {
    const difference = compare(count + " undeclared keys " + label, text);
    if (difference) {
      differences++;
      console.log(difference);
    }
  }
}
console.log(differences + " of " + counts.length * 6 + " texts differ from JSON.parse without a type argument");
