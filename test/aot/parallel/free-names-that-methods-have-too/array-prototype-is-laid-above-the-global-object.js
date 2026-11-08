const answers = [];
for (const act of [() => Object.setPrototypeOf(globalThis, Array.prototype), () => { globalThis.__proto__ = Array.prototype; }, () => Reflect.setPrototypeOf(globalThis, Array.prototype)]) {
  try { answers.push(String(act())); } catch (error) { answers.push(error.constructor.name); }
}
console.log(answers.join(), typeof map, Object.getPrototypeOf(globalThis) === Array.prototype);
console.log(map.call([1, 2], value => value * 2).join(), filter.call([1, 2, 3], value => value > 1).join(), at.call(["first", "last"], -1));
