// An error at a shorthand property is reported at its name, however the object is spaced. `{ a: a }` is printed `{ a }`: at the key.
function show(run) {
  try {
    run();
  } catch (error) {
    console.log(error.message, error.stack.split("\n")[1].replace(/.*[\\/]/, ""));
  }
}
function f() {}
show(() => { const o = { missingName }; return o; });
show(() => { const o = {missingName}; return o; });
show(() => { const o = { missingName, x: 1 }; return o; });
show(() => { const o = { x: 1, missingName, y: 2 }; return o; });
show(() => { f({ missingName }, 1); });
show(() => { f([{ missingName }]); });
show(() => { f({ missingName }.x); });
show(() => { return { missingName }; });
show(() => { const o = { m }; return o; });
show(() => { let late = { late }; });
show(() => { let late = { x: 1, late }; });
show(() => { const { a = { missingName } } = {}; return a; });
show(() => { const o = { missingName, otherMissingName }; return o; });
show(() => { const o = { async, get, set }; return o; });
show(() => { const o = { missingName: missingName }; return o; });
show(() => { const o = { "missingName": missingName }; return o; });
show(() => { const o = { ["missingName"]: missingName }; return o; });
show(() => { const o = { x: 1, missingName: missingName, y: 2 }; return o; });
show(() => { f({ missingName: missingName }); });
show(() => { let late = { late: late }; });
show(() => {
  const o = {
    missingName,
  };
  return o;
});
show(() => {
  const o = {
    x: 1,
    missingName,
    y: 2,
  };
  return o;
});
show(() => {
  const o = {
    missingName
  }; return o;
});
