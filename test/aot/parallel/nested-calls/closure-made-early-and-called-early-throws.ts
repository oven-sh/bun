function outer(callEarly: boolean) {
  const run = () => f();
  let said = "";
  if (callEarly) { try { said += run(); } catch (e) { said += (e as Error).name; } }
  const f = () => "filled";
  return said + ":" + run() + ":" + f();
}
console.log(outer(true), outer(false));
