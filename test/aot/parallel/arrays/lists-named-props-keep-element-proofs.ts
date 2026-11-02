// A list that gets named properties, as a parser's node lists do, keeps what is proven of its elements when push, find, at, some, every, forEach, indexOf or includes is called on it: they look at the elements alone.
// IR-UNTIL ApplyFlowResults
// IR= 1 kindsOfPushed b0\(v0: Array<L\d+, proven, Contiguous, pristine\[Storage, Dense\]>
// IR= 1 kindsOfSearched b0\(v0: Array<L\d+, proven, Contiguous, pristine\[Storage, Dense\]>
// IR= 1 kindsOfIndexed b0\(v0: Array<L\d+, proven, Contiguous, pristine\[Storage, Dense\]>
// IR= 1 kindsOfVisited b0\(v0: Array<L\d+, proven, Contiguous, pristine\[Storage, Dense\]>
class Pushed { constructor(public kind: number) {} }
interface PushedList extends Array<Pushed> { pos: number; end: number; }
function listOfPushed(count: number): Pushed[] { const list: Pushed[] = []; for (let i = 0; i < count; i++) list.push(new Pushed(i)); return list; }
function finishPushed(elements: Pushed[]): PushedList { const list = elements as PushedList; list.pos = -1; list.end = -1; return list; }
function kindsOfPushed(list: PushedList) { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i].kind; return sum; }

class Searched { constructor(public kind: number) {} }
interface SearchedList extends Array<Searched> { pos: number; end: number; }
function listOfSearched(count: number): Searched[] { const list: Searched[] = []; for (let i = 0; i < count; i++) list.push(new Searched(i)); return list; }
function finishSearched(elements: Searched[]): SearchedList { const list = elements as SearchedList; list.pos = -1; list.end = -1; return list; }
function kindsOfSearched(list: SearchedList) { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i].kind; return sum; }
function search(list: SearchedList) { return list.find(node => node.kind === 3)!.kind + list.findLast(node => node.kind < 3)!.kind * 10 + list.findIndex(node => node.kind === 5) * 100; }

class Indexed { constructor(public kind: number) {} }
interface IndexedList extends Array<Indexed> { pos: number; end: number; }
function listOfIndexed(count: number): Indexed[] { const list: Indexed[] = []; for (let i = 0; i < count; i++) list.push(new Indexed(i)); return list; }
function finishIndexed(elements: Indexed[]): IndexedList { const list = elements as IndexedList; list.pos = -1; list.end = -1; return list; }
function kindsOfIndexed(list: IndexedList) { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i].kind; return sum; }
function last(list: IndexedList) { return list.at(-1)!.kind; }

class Visited { constructor(public kind: number) {} }
interface VisitedList extends Array<Visited> { pos: number; end: number; }
function listOfVisited(count: number): Visited[] { const list: Visited[] = []; for (let i = 0; i < count; i++) list.push(new Visited(i)); return list; }
function finishVisited(elements: Visited[]): VisitedList { const list = elements as VisitedList; list.pos = -1; list.end = -1; return list; }
function kindsOfVisited(list: VisitedList) { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i].kind; return sum; }
function visit(list: VisitedList, node: Visited) {
  let sum = 0;
  list.forEach(each => { sum += each.kind; });
  return sum + (list.some(each => each.kind === 3) ? 100 : 0) + (list.every(each => each.kind >= 0) ? 200 : 0) + list.indexOf(node) * 1000 + (list.includes(node) ? 10000 : 0) + list.reduce((total, each) => total + each.kind, 0) * 100000;
}

let total = 0;
for (let round = 0; round < 300; round++) {
  const pushed = finishPushed(listOfPushed(8));
  const searched = finishSearched(listOfSearched(8));
  const indexed = finishIndexed(listOfIndexed(8));
  const visited = finishVisited(listOfVisited(8));
  total += kindsOfPushed(pushed) + pushed.pos + kindsOfSearched(searched) + search(searched) + kindsOfIndexed(indexed) + last(indexed) + kindsOfVisited(visited) + visit(visited, visited[2]) + visited.end;
}
console.log(total);
