// An element that is undefined is there: `in`, keys, forEach and the methods that pass over holes tell it from a hole.
function places() { return [undefined, undefined]; }
function nothing() { return [null]; }
function holes() { return [, ,]; }
for (let round = 0; round < 3; round++) {
    const list = places(), none = nothing(), gaps = holes();
    let visited = 0;
    list.forEach(() => visited++);
    let visitedGaps = 0;
    gaps.forEach(() => visitedGaps++);
    console.log(0 in list, 1 in list, 2 in list, 0 in gaps, Object.keys(list).join(), Object.keys(gaps).join() === "", visited, visitedGaps);
    console.log(list.indexOf(undefined), list.includes(undefined), gaps.indexOf(undefined), gaps.includes(undefined), none.indexOf(null), Object.hasOwn(list, "1"), Object.hasOwn(gaps, "1"));
    console.log(JSON.stringify(list), JSON.stringify(none), JSON.stringify(gaps), String(list) === ",", list.flat().length, gaps.flat().length);
    console.log(JSON.stringify(Object.getOwnPropertyDescriptor(list, 0)), Object.getOwnPropertyDescriptor(gaps, 0));
}
