// COUNTER: FieldsLeftSlotByRedefinition = 1
function hideX(point) {
  Object.defineProperty(point, "x", { enumerable: false });
  return Object.keys(point).join() + " " + point.x + " " + point.y;
}
async function later() {
  for (let i = 0; i < 10; i++) await i;
  console.log("later", hideX({ x: 1, y: 2 }));
}
later();
console.log("the module has ended");
