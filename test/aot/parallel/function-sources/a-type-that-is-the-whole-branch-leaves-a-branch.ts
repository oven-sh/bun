// Flags: --aot-testing=TypeErrorsWarn
function counted(flag: boolean) {
  let calls = 0;
  if (flag) type Gone = number;
  calls++;
  return calls;
}
function inTheOtherBranch(flag: boolean) {
  let calls = 0;
  if (flag) calls += 2; else interface Gone {}
  calls++;
  return calls;
}
function inALoop(flag: boolean) {
  let calls = 0;
  for (let turn = 0; turn < 3; turn++) type Gone = number;
  calls++;
  while (calls > 5) type More = number;
  calls++;
  return calls;
}
function behindALabel(flag: boolean) {
  let calls = 0;
  named: type Gone = number;
  calls++;
  return calls;
}
function control(flag: boolean) {
  let calls = 0;
  if (flag) { type Gone = number; }
  calls++;
  return calls;
}
for (const asked of [counted, inTheOtherBranch, inALoop, behindALabel, control]) {
  const again = new Function("return (" + String(asked) + "\n)")();
  console.log(asked.name, asked(false), again(false), asked(true), again(true));
}
