function keepAll(..._: unknown[]): any { return arguments; }
function keep(...values: unknown[]): any { const grown: unknown[] = []; for (const value of values) grown.push(value); return keepAll(...grown); }
const say = (label: string, value: unknown) => console.log(label, JSON.stringify(value));
const fractions = keep(1.5, 2.5, -0.25);
say("the first spread of the program", [...fractions]);
const spread = (kept: any): unknown[] => [...kept];
say("through a function", spread(keep(0.5, 1.25)));
say("again", spread(keep(3.5)));
const into: unknown[] = [];
into.push(...[]);
say("behind nothing", [...[], ...keep(7.5, 8.5)]);
function fresh(kept: any) { const list = []; list.push(...kept); return list; }
say("pushed onto an empty list", fresh(keep(9.5, 10.5)));
say("mixed with whole numbers", spread(keep(1, 2.5, 3)));
say("behind fractions", [0.5, ...keep(1.5, 2.5)]);
say("behind fractions, whole numbers", [0.5, ...keep(1, 2)]);
say("a large one", spread(keep(...Array.from({ length: 40 }, (_, at) => at + 0.5))).slice(36));
for (let turn = 0; turn < 3; turn++) say("in a loop", spread(keep(turn + 0.5, turn + 1.5)));
