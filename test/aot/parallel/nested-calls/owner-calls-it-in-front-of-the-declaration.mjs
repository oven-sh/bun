function once() {
  try { return f(); } catch (e) { return e.name; }
  const f = () => 1;
}
function inALoop() {
  let said = "";
  for (let i = 0; i < 2; i++) {
    try { said += f(); } catch (e) { said += e.name; }
    const f = () => i;
    said += f();
  }
  return said;
}
console.log(once(), inALoop());
