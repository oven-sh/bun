console.log(Object.keys(process.memoryUsage).length);
function step() {
  const copy = { ...Object };
  return Reflect.ownKeys(Object).map(String).join();
}
console.log(step());
