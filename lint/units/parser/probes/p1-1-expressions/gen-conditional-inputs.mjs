// Conditional / case / arrow-return-type interplay. Prints a JSON list of inputs.
const out = [];
const P = ["(b)", "(b, c)", "((b))", "(b = 1)", "({ b })", "([b])", "(...b)", "()", "(b?)", "(b: B)", "async (b)", "async ()", "<T>(b)", "<T,>(b)", "async <T>(b)", "(this)"];
const PRE = ["", "y => ", "(y) => ", "async y => ", "async (y) => ", "<T>(y) => ", "z = ", "z += ", "z ??= ", "-", "!", "typeof ", "void ", "await ", "1 + ", "1 , ", "y || ", "y ?? ", "y && ", "new ", "...", "yield ", "q ? r : ", "q ? ", "[", "f(", "{ k: ", "`${", "y = z => ", "y => z => "];
const POST = { "[": "]", "f(": ")", "{ k: ": " }", "`${": "}`" };
for (const pre of PRE) for (const p of P) {
  const close = POST[pre] ?? "";
  const body = pre === "q ? " ? `${pre}${p} : s` : `${pre}${p}`;
  // true branch, arrow in the false branch
  if (!close) {
    out.push(`x = a ? ${body} : c => d;`);
    out.push(`x = a ? ${body} : c;`);
    out.push(`x = a ? ${body} : c => d : e;`);
    out.push(`x = a ? ${body}: C => d : e;`);
  } else {
    out.push(`x = a ? ${pre}${p} : c => d${close} : e;`);
    out.push(`x = a ? ${pre}${p}${close} : c => d;`);
  }
}
for (const p of P) {
  out.push(`switch (x) { case ${p}: c => d; }`);
  out.push(`switch (x) { case -${p}: c; }`);
  out.push(`switch (x) { case 1 + ${p}: c; }`);
  out.push(`x = a ? b : ${p} : c => d;`);
  out.push(`x = a ? b ? ${p} : c => d : e;`);
  out.push(`x = a ? b ? ${p} : c : e => f;`);
  out.push(`x = a ? b ? c : ${p} : e => f;`);
  out.push(`x = a ? b ? ${p}: C => d : e : f;`);
  out.push(`x = ${p}: C => d;`);
  out.push(`x = 1 + ${p};`);
  out.push(`x = -${p};`);
  out.push(`for (const k of a ? ${p} : c => d) {}`);
  out.push(`x = { [a ? ${p} : c => d]: 1 };`);
  out.push(`x = a ? (${p}) : c => d;`);
  out.push(`x = a ? [${p}] : c => d;`);
  out.push(`x = a ? f(${p}) : c => d;`);
}
console.log(JSON.stringify([...new Set(out)]));
