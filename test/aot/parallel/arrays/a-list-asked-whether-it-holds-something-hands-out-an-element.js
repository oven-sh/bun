// COUNT: branches <= 50000
function countDown(from) {
  const stack = [from];
  let visited = 0;
  while (stack.length) {
    const at = stack.pop();
    visited += at & 1;
    if (at > 0) stack.push(at - 1);
    if (at > 4 && at % 5 === 0) stack.push(at - 3);
  }
  return visited;
}
let visited = 0;
for (let i = 0; i < 20; i++) visited += countDown(i);
console.log(visited);

function reach(start) {
  const seen = new Uint8Array(64);
  const stack = [start];
  let reached = 0;
  while (stack.length) {
    const at = stack.pop();
    if (seen[at]) continue;
    seen[at] = 1;
    reached++;
    if (at > 0) stack.push(at - 1);
    if (at < 63) stack.push(at + 1);
  }
  return reached;
}
let reached = 0;
for (let i = 0; i < 64; i++) reached += reach(i);
console.log(reached);

function drain(queue) {
  let text = "";
  while (queue.length > 0) text += queue.shift() + ";";
  return text;
}
console.log(drain([1, 2, 3]), drain([1.5, -0, NaN]), drain(["a", "b"]), drain([]));

function names(tree) {
  const open = [tree];
  let text = "";
  while (1 <= open.length) {
    const node = open.pop();
    text += node.name;
    for (const child of node.children) open.push(child);
  }
  return text;
}
console.log(names({ name: "a", children: [{ name: "b", children: [] }, { name: "c", children: [{ name: "d", children: [] }] }] }));

function withHoles() {
  const list = [1, , 3, undefined, 5];
  const seen = [];
  while (list.length) seen.push(String(list.pop()));
  return seen.join();
}
console.log(withHoles());

function cutShortBehindTheTest(list) {
  if (list.length) {
    list.length = 0;
    return String(list.pop());
  }
  return "empty";
}
console.log(cutShortBehindTheTest([1, 2]), cutShortBehindTheTest([]));

function empty(list) {
  while (list.length) list.pop();
}
function emptiedByACallBehindTheTest(list) {
  if (list.length) {
    empty(list);
    return String(list.shift());
  }
  return "empty";
}
console.log(emptiedByACallBehindTheTest([1, 2]), emptiedByACallBehindTheTest([]));

function twoOutBehindOneTest(list) {
  if (list.length) return String(list.pop()) + String(list.pop());
  return "empty";
}
console.log(twoOutBehindOneTest([7]), twoOutBehindOneTest([7, 8]), twoOutBehindOneTest([]));

function anotherListIsAsked(asked, taken) {
  if (asked.length) return String(taken.pop());
  return "empty";
}
console.log(anotherListIsAsked([1], []), anotherListIsAsked([1], [2]), anotherListIsAsked([], [2]));

function testsThatSayNothing(list) {
  const seen = [];
  if (list.length > -1) seen.push(String(list.pop()));
  if (list.length >= 0) seen.push(String(list.pop()));
  if (list.length < 5) seen.push(String(list.pop()));
  if (!list.length) seen.push(String(list.pop()));
  return seen.join();
}
console.log(testsThatSayNothing([]), testsThatSayNothing([1]), testsThatSayNothing([1, 2, 3, 4, 5, 6]));

function onTheOtherEdge(list) {
  if (list.length < 1) return "empty";
  return String(list.pop());
}
function behindNot(list) {
  if (!list.length) return "empty";
  return String(list.shift());
}
console.log(onTheOtherEdge([]), onTheOtherEdge([4]), behindNot([]), behindNot([4, 5]));
