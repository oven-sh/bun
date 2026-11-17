const told = [];
let shared = [1, 2, 3];
function show(value, depth = 0) {
  return (Array.isArray(value) ? "[" : "{") + Object.keys(value).slice(0, 20).map(key => key + ":" + show(value[key], depth + 1)).join() + "}";
}
function make0(count) {
  let i = 0;
  return {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      const result = i < 1 ? { value: [i, i + 1] } : { done: true };
      i++;
      return result;
    },
    return(value) {
      note("closed");
      return { done: true, value };
    },
  };
}
function make1(count) {
  let i = 0;
  return {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      const result = i < 2 ? { value: 0.5 + i, done: false } : { value: "end", done: true };
      i++;
      return result;
    },
    return(value) {
    },
  };
}
function work1(count) {
  let total = 0;
  let turns = 0;
  for (let round = 0; round < 2; round++) {
    for (let again = 0; again < 2; again++) {
      const iteach2 = stepper(make0(1));
      let aheadeach2 = iteach2.next();
      while (!aheadeach2.done && turns++ < 20) {
        const now = aheadeach2;
        aheadeach2 = iteach2.next();
        total += plain(now.value);
        if (now === aheadeach2) total += 1;
      }
    }
  }
  return total + "|" + turns + "|" + show(last);
}
function work2(count) {
  for (let round = 0; round < 2; round++) {
    for (let again = 0; again < 2; again++) {
      try {
        const each3 = make1(count)[Symbol.iterator]?.();
      } catch (error) {
        note((error)?.name);
      }
    }
  }
  return total + "|" + turns + "|" + show(last);
}
let saved = null;
const kept2 = [];
function stepper(from) {
  return typeof from?.next === "function" ? from : from[Symbol.iterator]();
}
function plain(value) {
  return typeof value === "number" ? value : typeof value === "string" ? value.length : value ? 1 : 0;
}
try {
  console.log(show(work1(JSON.parse("1"))));
} catch (error) {
  console.log("threw", (error)?.name);
}
shared = [1, 2, 3];
try {
  console.log(show(work2(JSON.parse("5"))));
} catch (error) {
  console.log("threw", (error)?.name);
}
