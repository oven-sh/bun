function early() {
  try { return hoisted(); } catch (e) { return (e as Error).name; }
  const f = () => "filled";
  function hoisted() { return f(); }
}
function lateAndEarly(first: boolean) {
  let said = "";
  if (first) { try { said += hoisted(); } catch (e) { said += (e as Error).name; } }
  const f = () => "filled";
  said += ":" + hoisted() + ":" + f();
  return said;
  function hoisted() { return f(); }
}
console.log(early(), lateAndEarly(true), lateAndEarly(false));
