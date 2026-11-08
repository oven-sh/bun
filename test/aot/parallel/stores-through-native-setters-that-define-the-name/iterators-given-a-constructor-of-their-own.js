function make(changed) {
  const steps = new Set([1, 2]).values();
  if (changed) steps.constructor = "mine";
  return steps;
}
let text = "";
for (let i = 0; i < 4; i++) {
  const steps = make(i % 2 === 1);
  text += typeof steps.constructor + Object.keys(steps).length + [...steps].length + ";";
}
console.log(text);

const ofList = [1.5, "two"].values();
ofList.constructor = 1.5;
console.log(typeof ofList.constructor, ofList.constructor, Object.keys(ofList).join(), Object.hasOwn(ofList, "constructor"), ofList.next().value);

const ofMap = new Map([[1, 2]]).keys();
ofMap.constructor = 2.5;
console.log(ofMap.constructor, Object.getOwnPropertyNames(ofMap).join(), JSON.stringify({ ...ofMap }), [...ofMap].join());

class Steps extends Iterator {
  next() {
    return { done: true, value: undefined };
  }
}
const steps = new Steps();
steps[Symbol.toStringTag] = "mine";
steps.constructor = 7;
console.log(Object.prototype.toString.call(steps), steps.constructor, Reflect.ownKeys(steps).length, Object.keys(steps).join());

const helper = [1, 2].values().map(x => x);
helper.constructor = 8;
console.log(helper.constructor, Object.keys(helper).join(), helper.next().value);

const untouched = [3].values();
console.log(untouched.constructor === Iterator, Object.keys(untouched).length, untouched[Symbol.toStringTag]);
