const said = [];
for (let turn = 0; turn < 200; turn++) {
  said.length = 0;
  const reason = AbortSignal.abort().reason;
  said.push(typeof reason.stack, typeof reason.line, typeof reason.column, reason.name, reason.message, reason.code, Object.getOwnPropertyNames(reason).sort().join(), "stack" in reason, Object.hasOwn(reason, "line"));
  const controller = new AbortController(); controller.abort();
  const other = controller.signal.reason;
  said.push(typeof other.stack, typeof other.line, typeof other.column, typeof other.sourceURL, other instanceof DOMException);
  const late = AbortSignal.timeout(0);
  said.push(typeof late.reason);
}
console.log(said.join("\n"));
