// a small constructor constructs its own class without end: the stack overflows, the error is caught, and the program goes on
let turns = 0;
let limit = 0;
class Shell {
  inner: Shell | null;
  constructor() {
    turns++;
    this.inner = limit && turns >= limit ? null : new Shell();
  }
}
function depthOf(shell: Shell | null) {
  let depth = 0;
  for (; shell; shell = shell.inner) depth++;
  return depth;
}
function deed() {
  turns = 0;
  try {
    return String(depthOf(new Shell()));
  } catch (e) {
    return (e as Error).name + " " + (turns > 100);
  }
}
console.log(deed());
for (let i = 0; i < 3; i++) console.log(deed());
limit = 5;
console.log(deed());
