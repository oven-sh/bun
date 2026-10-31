// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
function show(value) {
  console.log(value);
}
show(JSON.parse('{"a":[1,{"b":null}]}'));
show(new URL("file:///x"));
