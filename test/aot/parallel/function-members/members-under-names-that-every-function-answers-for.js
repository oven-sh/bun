// A store under such a name meets a property that is there already, its own or an inherited one.
function F() {}
for (const store of [() => (F.name = 5), () => (F.length = 5), () => (F.call = 5), () => (F.toString = () => "text"), () => (F.constructor = 5), () => (F.hasOwnProperty = 5)]) {
  try {
    store();
  } catch (error) {
    console.log(error.constructor.name);
  }
}
console.log(F.name, F.length, F.call, `${F}`, F.constructor, F.hasOwnProperty);
