interface Input {
  text: string;
  start: number;
  count: number;
  flag: boolean;
}
const inputs: Input[] = JSON.parse('[{"text":"alpha beta","start":0,"count":10,"flag":true},{"text":"gamma","start":1,"count":3,"flag":false}]');
const strange: any[] = JSON.parse('[{"text":7,"start":"2","count":null,"flag":"yes"},{}]');
const lines: string[] = [];
function nameOf(run: () => unknown): string {
  try {
    return JSON.stringify(run()) ?? "undefined";
  } catch (error) {
    return (error as Error).name + ": " + (error as Error).message;
  }
}

function everyReadFollowsTheDeclaration() {
  let text: string;
  let position: number;
  let end: number;
  let flag: boolean = false;
  const limit: number = inputs[0].count;
  function set(input: Input) {
    text = input.text;
    position = input.start;
    end = input.start + input.count;
    flag = input.flag;
  }
  function step(): string {
    let out = "";
    while (position < end && position < limit) out += text[position++];
    return out;
  }
  return { set, step, state: () => [text, position, end, flag, limit] };
}
for (let round = 0; round < 2; round++) {
  const reader = everyReadFollowsTheDeclaration();
  lines.push(nameOf(reader.state), nameOf(reader.step));
  for (const input of inputs) {
    reader.set(input);
    lines.push(nameOf(reader.step), nameOf(reader.state));
  }
  for (const input of strange) {
    reader.set(input);
    lines.push(nameOf(reader.step), nameOf(reader.state));
  }
}

function aHoistedFunctionIsCalledFirst(input: Input) {
  const early = nameOf(read);
  let held: number = input.start;
  function read() {
    return held;
  }
  return [early, nameOf(read)];
}
function anArrowIsCalledFirst(input: Input) {
  const read = () => held;
  const write = (value: number) => {
    held = value;
  };
  const early = nameOf(read);
  const earlyWrite = nameOf(() => write(input.count));
  let held: number = input.start;
  write(held + 1);
  return [early, earlyWrite, nameOf(read)];
}
function theClosureEscapesFirst(input: Input, sink: Array<() => unknown>) {
  sink.push(() => held);
  const early = nameOf(sink[sink.length - 1]);
  let held: string = input.text;
  return [early, nameOf(sink[sink.length - 1])];
}
function theDeclarationIsSkipped(input: Input, which: number) {
  switch (which) {
    case 0:
      let held: number = input.count;
      return nameOf(() => held);
    default:
      return nameOf(() => held);
  }
}
function theDeclarationRunsInSomeRounds(list: Input[]) {
  const out: string[] = [];
  for (let i = 0; i < 3; i++) {
    const read = () => held;
    if (i === 1) out.push(nameOf(read));
    let held: number = list[i % list.length].start + i;
    out.push(nameOf(read));
  }
  return out;
}
function aDefaultReadsALaterParameter(input: Input) {
  const call = (first = () => second, second: number = input.count) => first();
  const early = (first = () => second, middle = nameOf(first), second: number = input.count) => middle + " then " + first();
  return [nameOf(call), nameOf(early)];
}
function aClassReadsItselfTooEarly(input: Input) {
  const early = nameOf(() => new Held());
  class Held {
    value = input.text;
  }
  return [early, nameOf(() => new Held().value)];
}
function* aGeneratorStopsInFront(input: Input) {
  const read = () => held;
  yield nameOf(read);
  let held: number = input.start;
  yield nameOf(read);
}
const sink: Array<() => unknown> = [];
for (const input of [...inputs, ...strange]) {
  lines.push(
    aHoistedFunctionIsCalledFirst(input).join(" | "),
    anArrowIsCalledFirst(input).join(" | "),
    theClosureEscapesFirst(input, sink).join(" | "),
    theDeclarationIsSkipped(input, 0),
    theDeclarationIsSkipped(input, 1),
    aDefaultReadsALaterParameter(input).join(" | "),
    aClassReadsItselfTooEarly(input).join(" | "),
    [...aGeneratorStopsInFront(input)].join(" | "),
  );
}
lines.push(theDeclarationRunsInSomeRounds(inputs).join(" | "), sink.map(nameOf).join(" | "));

lines.push(nameOf(readsTheModuleVariable));
let moduleVariable: number = inputs[1].count;
function readsTheModuleVariable() {
  return moduleVariable;
}
lines.push(nameOf(readsTheModuleVariable));
moduleVariable = strange[0].start;
lines.push(nameOf(readsTheModuleVariable));
console.log(lines.join("\n"));
