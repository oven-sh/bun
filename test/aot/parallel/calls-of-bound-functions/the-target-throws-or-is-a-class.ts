class Gate { constructor(public open: boolean) {} }
function fails(this: unknown, code: number): never { throw new RangeError("code " + code); }
const failing = fails.bind(null, 7), gate: any = (Gate as any).bind(null, true);
let text = "";
for (let round = 0; round < 3; round++) {
  try { failing(); } catch (error) { text += (error as Error).message + ";"; }
  try { gate(); } catch (error) { text += (error as Error).constructor.name + ";"; }
  text += new gate().open + ";";
}
console.log(text);
