// for in over keys inside for of over objects, with keys deleted and added
function keys(objects) {
  const seen = [];
  for (const object of objects) {
    for (const key in object) {
      seen.push(key);
      if (key === "drop") delete object.next;
      if (typeof object[key] === "object" && object[key]) for (const inner in object[key]) seen.push(key + "." + inner);
      if (seen.length > 12) return seen.join() + " cut";
    }
    seen.push("|");
  }
  return seen.join();
}
console.log(keys([{ a: 1, b: { c: 2, d: 3 } }, [7, 8]]));
console.log(keys([{ drop: 1, next: 2, last: 3 }, "xy"]));
console.log(keys([{ 2: 0, 1: 0, z: [5] }, Object.create({ up: 1 }), null, { e: { f: 1, g: 2, h: 3 }, i: 4 }]));
