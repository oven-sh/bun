interface Context {
  depth: number;
  width: number;
  label: string;
  names: Set<string>;
}

function start(): Context {
  return { depth: 0, width: 3, label: "root", names: new Set() };
}

function descend(outer: Context): Context {
  return { ...outer, depth: outer.depth + 1, names: new Set(outer.names) };
}

function measure(context: Context): number {
  return context.depth * context.width + context.label.length + context.names.size;
}

let total = 0;
let context = start();
for (let turn = 0; turn < 1000; turn++) {
  context = descend(context);
  context.names.add(context.label + (turn & 7));
  total += measure(context);
}
console.log(total);
