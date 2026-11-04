// The name comes to Object.prototype behind the warming of the place. A compiled executable refuses the store; whoever is let through must be seen at the next read.
interface Options {
  depth: number;
  signal?: string;
  name: string;
}
function bare(): Options {
  return { depth: 2, name: "bare" };
}
function signalOf(options: any) {
  return options.signal;
}
const unseen = new Function("signalOf", "bare", `
  let seen = 0;
  for (let turn = 0; turn < 400; turn++) { if (signalOf(bare()) === undefined) seen++; }
  const lines = ["warmed " + seen];
  let stored = true;
  try { Object.defineProperty(Object.prototype, "signal", { get() { return "of Object.prototype"; }, configurable: true }); } catch (error) { stored = false; }
  const has = "signal" in { };
  lines.push(String(signalOf(bare()) === (has ? "of Object.prototype" : undefined)));
  if (has) delete Object.prototype.signal;
  lines.push(String(signalOf(bare())));
  return lines.join("\\n");
`);
console.log(unseen(signalOf, bare));
