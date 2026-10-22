let calls = 0;
class Special extends Promise {
  constructor(...passed) {
    super(...passed);
    calls++;
    console.log("constructor", passed.length, typeof passed[0], new.target === Special);
  }
}
const result = Special.resolve(1.5);
const settled = await result;
console.log(typeof settled, settled + 1);
console.log(result instanceof Special, calls);
