// Array methods are called one on the result of the other: map, filter and slice, then length, reduce, forEach, some, every, find, findIndex, join or flatMap.
// Each callback takes a stack trace once, or throws. Each chain stands once in straight code, once in a loop and once in tail position. Each row prints the frames, and the place of each that is not of a built-in function.
const framesIn = (stack: unknown): string =>
  String(stack)
    .split("\n")
    .slice(1)
    .map(line =>
      line
        .trim()
        .replace(/^at /, "")
        .replace(/(?:[A-Z]:)?[\\/].*[\\/]/, "")
        .replace(/native:\d+:\d+/, "native"),
    )
    .join(" < ");
let taken: string[] = [];
function take<T>(name: string, value: T): T {
  if (!taken.some(row => row.startsWith(name + ": "))) taken.push(name + ": " + framesIn(new Error("taken").stack));
  return value;
}
function fail(n: number): never {
  throw new Error("fail " + n);
}
function show(name: string, run: () => unknown): void {
  taken = [];
  let result: string;
  try {
    result = JSON.stringify(run());
  } catch (error: any) {
    result = "threw " + error.message + " < " + framesIn(error.stack);
  }
  console.log(name + ": " + result);
  for (const row of taken) console.log("  " + row);
}
const list = [1, 2, 3, 4];
function mapThenLength(): unknown {
  const result = list.map(x => { const kept = take("mapper", x); return kept; }).length;
  console.log("mapThenLength is done");
  return result;
}
function mapThenLengthInALoop(): unknown {
  let result: unknown;
  for (let turn = 0; turn < 2; turn++) result = list.map(x => { const kept = take("mapper", x); return kept; }).length;
  return result;
}
function mapThenLengthInTailPosition(): unknown {
  return list.map(x => { const kept = take("mapper", x); return kept; }).length;
}
function mapThenReduce(): unknown {
  const result = list.map(x => { const kept = take("mapper", x * 2); return kept; }).reduce((a, b) => { const kept = take("reducer", a + b); return kept; }, 0);
  console.log("mapThenReduce is done");
  return result;
}
function mapThenReduceInALoop(): unknown {
  let result: unknown;
  for (let turn = 0; turn < 2; turn++) result = list.map(x => { const kept = take("mapper", x * 2); return kept; }).reduce((a, b) => { const kept = take("reducer", a + b); return kept; }, 0);
  return result;
}
function mapThenReduceInTailPosition(): unknown {
  return list.map(x => { const kept = take("mapper", x * 2); return kept; }).reduce((a, b) => { const kept = take("reducer", a + b); return kept; }, 0);
}
function callbacksEndInCalls(): unknown {
  const result = list.map(x => take("mapper", x * 2)).reduce((a, b) => take("reducer", a + b), 0);
  console.log("callbacksEndInCalls is done");
  return result;
}
function callbacksEndInCallsInALoop(): unknown {
  let result: unknown;
  for (let turn = 0; turn < 2; turn++) result = list.map(x => take("mapper", x * 2)).reduce((a, b) => take("reducer", a + b), 0);
  return result;
}
function callbacksEndInCallsInTailPosition(): unknown {
  return list.map(x => take("mapper", x * 2)).reduce((a, b) => take("reducer", a + b), 0);
}
function filterMapFilter(): unknown {
  const result = list.filter(x => { const kept = take("first filter", x > 1); return kept; }).map(x => { const kept = take("mapper", x * 3); return kept; }).filter(x => { const kept = take("second filter", x > 6); return kept; });
  console.log("filterMapFilter is done");
  return result;
}
function filterMapFilterInALoop(): unknown {
  let result: unknown;
  for (let turn = 0; turn < 2; turn++) result = list.filter(x => { const kept = take("first filter", x > 1); return kept; }).map(x => { const kept = take("mapper", x * 3); return kept; }).filter(x => { const kept = take("second filter", x > 6); return kept; });
  return result;
}
function filterMapFilterInTailPosition(): unknown {
  return list.filter(x => { const kept = take("first filter", x > 1); return kept; }).map(x => { const kept = take("mapper", x * 3); return kept; }).filter(x => { const kept = take("second filter", x > 6); return kept; });
}
function mapTwice(): unknown {
  const result = list.map(x => { const kept = take("first mapper", x + 4); return kept; }).map(x => { const kept = take("second mapper", x + 4); return kept; });
  console.log("mapTwice is done");
  return result;
}
function mapTwiceInALoop(): unknown {
  let result: unknown;
  for (let turn = 0; turn < 2; turn++) result = list.map(x => { const kept = take("first mapper", x + 4); return kept; }).map(x => { const kept = take("second mapper", x + 4); return kept; });
  return result;
}
function mapTwiceInTailPosition(): unknown {
  return list.map(x => { const kept = take("first mapper", x + 4); return kept; }).map(x => { const kept = take("second mapper", x + 4); return kept; });
}
function sliceThenMap(): unknown {
  const result = list.slice(1).map(x => { const kept = take("mapper", x); return kept; });
  console.log("sliceThenMap is done");
  return result;
}
function sliceThenMapInALoop(): unknown {
  let result: unknown;
  for (let turn = 0; turn < 2; turn++) result = list.slice(1).map(x => { const kept = take("mapper", x); return kept; });
  return result;
}
function sliceThenMapInTailPosition(): unknown {
  return list.slice(1).map(x => { const kept = take("mapper", x); return kept; });
}
function filterThenForEach(): unknown {
  const result = list.filter(x => { const kept = take("filter", x & 1); return kept; }).forEach(x => { const kept = take("visitor", x); return kept; });
  console.log("filterThenForEach is done");
  return result;
}
function filterThenForEachInALoop(): unknown {
  let result: unknown;
  for (let turn = 0; turn < 2; turn++) result = list.filter(x => { const kept = take("filter", x & 1); return kept; }).forEach(x => { const kept = take("visitor", x); return kept; });
  return result;
}
function filterThenForEachInTailPosition(): unknown {
  return list.filter(x => { const kept = take("filter", x & 1); return kept; }).forEach(x => { const kept = take("visitor", x); return kept; });
}
function mapThenSome(): unknown {
  const result = list.map(x => { const kept = take("mapper", x); return kept; }).some(x => { const kept = take("test", x > 2); return kept; });
  console.log("mapThenSome is done");
  return result;
}
function mapThenSomeInALoop(): unknown {
  let result: unknown;
  for (let turn = 0; turn < 2; turn++) result = list.map(x => { const kept = take("mapper", x); return kept; }).some(x => { const kept = take("test", x > 2); return kept; });
  return result;
}
function mapThenSomeInTailPosition(): unknown {
  return list.map(x => { const kept = take("mapper", x); return kept; }).some(x => { const kept = take("test", x > 2); return kept; });
}
function mapThenEvery(): unknown {
  const result = list.map(x => { const kept = take("mapper", x); return kept; }).every(x => { const kept = take("test", x < 2); return kept; });
  console.log("mapThenEvery is done");
  return result;
}
function mapThenEveryInALoop(): unknown {
  let result: unknown;
  for (let turn = 0; turn < 2; turn++) result = list.map(x => { const kept = take("mapper", x); return kept; }).every(x => { const kept = take("test", x < 2); return kept; });
  return result;
}
function mapThenEveryInTailPosition(): unknown {
  return list.map(x => { const kept = take("mapper", x); return kept; }).every(x => { const kept = take("test", x < 2); return kept; });
}
function mapThenFind(): unknown {
  const result = list.map(x => { const kept = take("mapper", x); return kept; }).find(x => { const kept = take("test", x > 2); return kept; });
  console.log("mapThenFind is done");
  return result;
}
function mapThenFindInALoop(): unknown {
  let result: unknown;
  for (let turn = 0; turn < 2; turn++) result = list.map(x => { const kept = take("mapper", x); return kept; }).find(x => { const kept = take("test", x > 2); return kept; });
  return result;
}
function mapThenFindInTailPosition(): unknown {
  return list.map(x => { const kept = take("mapper", x); return kept; }).find(x => { const kept = take("test", x > 2); return kept; });
}
function mapThenFindIndex(): unknown {
  const result = list.map(x => { const kept = take("mapper", x); return kept; }).findIndex(x => { const kept = take("test", x > 2); return kept; });
  console.log("mapThenFindIndex is done");
  return result;
}
function mapThenFindIndexInALoop(): unknown {
  let result: unknown;
  for (let turn = 0; turn < 2; turn++) result = list.map(x => { const kept = take("mapper", x); return kept; }).findIndex(x => { const kept = take("test", x > 2); return kept; });
  return result;
}
function mapThenFindIndexInTailPosition(): unknown {
  return list.map(x => { const kept = take("mapper", x); return kept; }).findIndex(x => { const kept = take("test", x > 2); return kept; });
}
function mapThenJoin(): unknown {
  const result = list.map(x => { const kept = take("mapper", x); return kept; }).join("-");
  console.log("mapThenJoin is done");
  return result;
}
function mapThenJoinInALoop(): unknown {
  let result: unknown;
  for (let turn = 0; turn < 2; turn++) result = list.map(x => { const kept = take("mapper", x); return kept; }).join("-");
  return result;
}
function mapThenJoinInTailPosition(): unknown {
  return list.map(x => { const kept = take("mapper", x); return kept; }).join("-");
}
function mapThenFlatMap(): unknown {
  const result = list.map(x => { const kept = take("mapper", x); return kept; }).flatMap(x => { const kept = take("flattener", [x, x]); return kept; });
  console.log("mapThenFlatMap is done");
  return result;
}
function mapThenFlatMapInALoop(): unknown {
  let result: unknown;
  for (let turn = 0; turn < 2; turn++) result = list.map(x => { const kept = take("mapper", x); return kept; }).flatMap(x => { const kept = take("flattener", [x, x]); return kept; });
  return result;
}
function mapThenFlatMapInTailPosition(): unknown {
  return list.map(x => { const kept = take("mapper", x); return kept; }).flatMap(x => { const kept = take("flattener", [x, x]); return kept; });
}
function mapperThrows(): unknown {
  const result = list.map(x => (x === 2 ? fail(x) : x)).reduce((a, b) => a + b, 0);
  console.log("mapperThrows is done");
  return result;
}
function mapperThrowsInALoop(): unknown {
  let result: unknown;
  for (let turn = 0; turn < 2; turn++) result = list.map(x => (x === 2 ? fail(x) : x)).reduce((a, b) => a + b, 0);
  return result;
}
function mapperThrowsInTailPosition(): unknown {
  return list.map(x => (x === 2 ? fail(x) : x)).reduce((a, b) => a + b, 0);
}
function reducerThrows(): unknown {
  const result = list.map(x => x + 1).reduce((a, b) => (b === 3 ? fail(b) : a + b), 0);
  console.log("reducerThrows is done");
  return result;
}
function reducerThrowsInALoop(): unknown {
  let result: unknown;
  for (let turn = 0; turn < 2; turn++) result = list.map(x => x + 1).reduce((a, b) => (b === 3 ? fail(b) : a + b), 0);
  return result;
}
function reducerThrowsInTailPosition(): unknown {
  return list.map(x => x + 1).reduce((a, b) => (b === 3 ? fail(b) : a + b), 0);
}
function nothingToReduce(): unknown {
  const result = list.filter(x => x > 9).reduce((a, b) => a + b);
  console.log("nothingToReduce is done");
  return result;
}
function nothingToReduceInALoop(): unknown {
  let result: unknown;
  for (let turn = 0; turn < 2; turn++) result = list.filter(x => x > 9).reduce((a, b) => a + b);
  return result;
}
function nothingToReduceInTailPosition(): unknown {
  return list.filter(x => x > 9).reduce((a, b) => a + b);
}
function chainInACallback(): unknown {
  const result = list.map(x => { const inner = list.filter(y => { const kept = take("inner filter", y > x); return kept; }).length; return inner; });
  console.log("chainInACallback is done");
  return result;
}
function chainInACallbackInALoop(): unknown {
  let result: unknown;
  for (let turn = 0; turn < 2; turn++) result = list.map(x => { const inner = list.filter(y => { const kept = take("inner filter", y > x); return kept; }).length; return inner; });
  return result;
}
function chainInACallbackInTailPosition(): unknown {
  return list.map(x => { const inner = list.filter(y => { const kept = take("inner filter", y > x); return kept; }).length; return inner; });
}
function heldThenLength(): number {
  const mapped = list.map(x => take("mapper", x));
  return mapped.length;
}

show("mapThenLength", mapThenLength);
show("mapThenLengthInALoop", mapThenLengthInALoop);
show("mapThenLengthInTailPosition", mapThenLengthInTailPosition);
show("mapThenReduce", mapThenReduce);
show("mapThenReduceInALoop", mapThenReduceInALoop);
show("mapThenReduceInTailPosition", mapThenReduceInTailPosition);
show("callbacksEndInCalls", callbacksEndInCalls);
show("callbacksEndInCallsInALoop", callbacksEndInCallsInALoop);
show("callbacksEndInCallsInTailPosition", callbacksEndInCallsInTailPosition);
show("filterMapFilter", filterMapFilter);
show("filterMapFilterInALoop", filterMapFilterInALoop);
show("filterMapFilterInTailPosition", filterMapFilterInTailPosition);
show("mapTwice", mapTwice);
show("mapTwiceInALoop", mapTwiceInALoop);
show("mapTwiceInTailPosition", mapTwiceInTailPosition);
show("sliceThenMap", sliceThenMap);
show("sliceThenMapInALoop", sliceThenMapInALoop);
show("sliceThenMapInTailPosition", sliceThenMapInTailPosition);
show("filterThenForEach", filterThenForEach);
show("filterThenForEachInALoop", filterThenForEachInALoop);
show("filterThenForEachInTailPosition", filterThenForEachInTailPosition);
show("mapThenSome", mapThenSome);
show("mapThenSomeInALoop", mapThenSomeInALoop);
show("mapThenSomeInTailPosition", mapThenSomeInTailPosition);
show("mapThenEvery", mapThenEvery);
show("mapThenEveryInALoop", mapThenEveryInALoop);
show("mapThenEveryInTailPosition", mapThenEveryInTailPosition);
show("mapThenFind", mapThenFind);
show("mapThenFindInALoop", mapThenFindInALoop);
show("mapThenFindInTailPosition", mapThenFindInTailPosition);
show("mapThenFindIndex", mapThenFindIndex);
show("mapThenFindIndexInALoop", mapThenFindIndexInALoop);
show("mapThenFindIndexInTailPosition", mapThenFindIndexInTailPosition);
show("mapThenJoin", mapThenJoin);
show("mapThenJoinInALoop", mapThenJoinInALoop);
show("mapThenJoinInTailPosition", mapThenJoinInTailPosition);
show("mapThenFlatMap", mapThenFlatMap);
show("mapThenFlatMapInALoop", mapThenFlatMapInALoop);
show("mapThenFlatMapInTailPosition", mapThenFlatMapInTailPosition);
show("mapperThrows", mapperThrows);
show("mapperThrowsInALoop", mapperThrowsInALoop);
show("mapperThrowsInTailPosition", mapperThrowsInTailPosition);
show("reducerThrows", reducerThrows);
show("reducerThrowsInALoop", reducerThrowsInALoop);
show("reducerThrowsInTailPosition", reducerThrowsInTailPosition);
show("nothingToReduce", nothingToReduce);
show("nothingToReduceInALoop", nothingToReduceInALoop);
show("nothingToReduceInTailPosition", nothingToReduceInTailPosition);
show("chainInACallback", chainInACallback);
show("chainInACallbackInALoop", chainInACallbackInALoop);
show("chainInACallbackInTailPosition", chainInACallbackInTailPosition);
show("heldThenLength", heldThenLength);
show("behind a tail call", () => mapperThrowsInTailPosition());
function filteredLength(): number {
  return [1].filter(x => take("filter", x)).length;
}
show("in a function that a built-in calls", () => [1].findLast(filteredLength));
export {};
