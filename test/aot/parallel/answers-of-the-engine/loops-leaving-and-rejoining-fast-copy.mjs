// A loop is separated from its unlikely paths: those run in a copy, and at the end of a turn the copy goes back into the loop where what it carries passes the loop's tests. Here a carried value changes its kind in such a turn (a text for a number, a fraction for a whole number, another list, another layout) and changes back, or does not.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function mixed(list) { let last = 0; let sum = 0; for (let i = 0; i < list.length; i++) { const value = list[i]; if (typeof value === "string") { last = value; continue; } sum += value; last = value; } return sum + ":" + last; }
report(mixed([1, 2, 3]));
report(mixed([1, "a", 2, 3]));
report(mixed([1, 2, "z"]));
report(mixed(["a", "b"]));
function widened(limit) { let n = 0; for (let i = 0; i < limit; i++) { if (i === 3) n = n + 0.5; else if (i === 5) n = n - 0.5; else n = n + 1; } return n; }
report(widened(3));
report(widened(5));
report(widened(9));
function replaced(list, other) { let sum = 0; for (let i = 0; i < list.length; i++) { if (list[i] < 0) { list = other; i = -1; continue; } sum += list[i]; } return sum; }
report(replaced([1, 2], [5]));
report(replaced([1, -1, 2], [5, 6.5]));
report(replaced([1.5, -1], [1, undefined]));
function holder(points) { let best = points[0]; for (let i = 1; i < points.length; i++) { const point = points[i]; if (point === null) { best = { x: -1, tag: "none" }; continue; } if (point.x > best.x) best = point; } return best.x + ":" + best.tag; }
report(holder([{ x: 1 }, { x: 3 }, { x: 2 }]));
report(holder([{ x: 1 }, null, { x: 0 }]));
report(holder([{ x: 1 }, null]));
function text(parts) { let out = ""; let count = 0; for (let i = 0; i < parts.length; i++) { const part = parts[i]; if (part === undefined) { out = count; continue; } out += part; count++; } return out; }
report(text(["a", "b"]));
report(text(["a", undefined, "b"]));
report(text(["a", undefined]));
function thrower(list) { let sum = 0; for (let i = 0; i < list.length; i++) { try { if (list[i] === 0) throw new Error("zero at " + i); sum += 10 / list[i]; } catch (error) { sum = sum + error.message.length; } } return sum; }
report(thrower([1, 2, 5]));
report(thrower([1, 0, 5]));
report(thrower([0, 0]));
report("end");
