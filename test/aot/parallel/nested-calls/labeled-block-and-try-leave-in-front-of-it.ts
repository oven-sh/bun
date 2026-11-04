function outer(leave: boolean) {
  let said = "";
  block: {
    if (leave) break block;
    const f = () => "filled";
    said += f();
  }
  try {
    if (leave) throw new Error("left");
    const g = () => "tried";
    said += g();
  } catch { said += "caught"; } finally { said += "!"; }
  return said;
}
console.log(outer(false), outer(true));
