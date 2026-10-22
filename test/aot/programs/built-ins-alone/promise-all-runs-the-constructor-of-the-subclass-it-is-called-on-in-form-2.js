let calls = 0;
class Special extends Promise {
  constructor(...passed) {
    super(...passed);
    calls++;
    console.log("constructor", passed.length, typeof passed[0], new.target === Special);
  }
}
const result = Special.all("an");
const settled = await result;
console.log(Array.isArray(settled), settled.length, typeof settled[0], settled[0].length, settled[0]);
console.log(typeof settled[1], settled[1].length, settled[1]);
console.log(result instanceof Special, calls);
