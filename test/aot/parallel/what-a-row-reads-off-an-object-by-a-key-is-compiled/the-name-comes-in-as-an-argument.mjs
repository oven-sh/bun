// Where Reflect.get is called nobody knows the name.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
function take(list, name) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return Reflect.get(list, name);
}
console.log(take([], "map").call([1], count => count + 1).join(), take([], "some").call([1], count => count > 1));
