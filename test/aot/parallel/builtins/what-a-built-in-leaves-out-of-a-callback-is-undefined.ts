// A callback that a built-in calls: a parameter behind the last argument is undefined, and so is an item that its holder does not have: a hole, an index past what an
// array-like object holds, a group that did not take part. Each form has a class of its own, whose one field is declared a number: what one form stores says nothing of another.
// Only what the built-in itself makes, such as an index, is always there: the last form.
const said: string[] = [];
class FromLength {
  constructor(public held: number) {}
  twice() {
    return this.held * 2;
  }
}
class FromHoles {
  constructor(public held: number) {}
  twice() {
    return this.held * 2;
  }
}
class FromLike {
  constructor(public held: number) {}
  twice() {
    return this.held * 2;
  }
}
class FromLengthThird {
  constructor(public held: number) {}
  twice() {
    return this.held * 2;
  }
}
class Found {
  constructor(public held: number) {}
  twice() {
    return this.held * 2;
  }
}
class FoundLast {
  constructor(public held: number) {}
  twice() {
    return this.held * 2;
  }
}
class EachFourth {
  constructor(public held: number) {}
  twice() {
    return this.held * 2;
  }
}
class MapFourth {
  constructor(public held: number) {}
  twice() {
    return this.held * 2;
  }
}
class SortThird {
  constructor(public held: number) {}
  twice() {
    return this.held * 2;
  }
}
class ReduceFirst {
  constructor(public held: number) {}
  twice() {
    return this.held * 2;
  }
}
class ReduceFifth {
  constructor(public held: number) {}
  twice() {
    return this.held * 2;
  }
}
class Group {
  constructor(public held: number) {}
  twice() {
    return this.held * 2;
  }
}
class MapValue {
  constructor(public held: number) {}
  twice() {
    return this.held * 2;
  }
}
class MapFourthOfMap {
  constructor(public held: number) {}
  twice() {
    return this.held * 2;
  }
}
class ViewFourth {
  constructor(public held: number) {}
  twice() {
    return this.held * 2;
  }
}
class Timer {
  constructor(public held: number) {}
  twice() {
    return this.held * 2;
  }
}
class Then {
  constructor(public held: number) {}
  twice() {
    return this.held * 2;
  }
}
for (const made of Array.from({ length: 2 }, (item: any) => new FromLength(item))) said.push(`FromLength ${made.held} ${made.twice()}`);
for (const made of Array.from([1, , 3], (item: any) => new FromHoles(item))) said.push(`FromHoles ${made.held} ${made.twice()}`);
for (const made of Array.from({ length: 2, 1: 7 } as ArrayLike<number>, (item: number) => new FromLike(item))) said.push(`FromLike ${made.held} ${made.twice()}`);
for (const made of Array.from({ length: 2 }, ((item: any, index: number, third: any) => new FromLengthThird(third)) as any) as FromLengthThird[]) said.push(`FromLengthThird ${made.held} ${made.twice()}`);
for (const made of (list => ([1, , 3].find((item: any) => (list.push(new Found(item)), false)), list))([] as Found[])) said.push(`Found ${made.held} ${made.twice()}`);
for (const made of (list => ([1, , 3].findLast((item: any) => (list.push(new FoundLast(item)), false)), list))([] as FoundLast[])) said.push(`FoundLast ${made.held} ${made.twice()}`);
for (const made of (list => ([4, 5].forEach(((item: number, index: number, all: number[], fourth: any) => list.push(new EachFourth(fourth))) as any), list))([] as EachFourth[])) said.push(`EachFourth ${made.held} ${made.twice()}`);
for (const made of [4, 5].map(((item: number, index: number, all: number[], fourth: any) => new MapFourth(fourth)) as any) as MapFourth[]) said.push(`MapFourth ${made.held} ${made.twice()}`);
for (const made of (list => ([2, 1].sort(((left: number, right: number, third: any) => (list.push(new SortThird(third)), left - right)) as any), list))([] as SortThird[])) said.push(`SortThird ${made.held} ${made.twice()}`);
for (const made of (list => ([5, 6].reduce(((before: any, item: number) => (list.push(new ReduceFirst(before)), undefined)) as any, undefined), list))([] as ReduceFirst[])) said.push(`ReduceFirst ${made.held} ${made.twice()}`);
for (const made of (list => ([5, 6, 7].reduce(((before: any, item: number, index: number, all: number[], fifth: any) => (list.push(new ReduceFifth(fifth)), 0)) as any), list))([] as ReduceFifth[])) said.push(`ReduceFifth ${made.held} ${made.twice()}`);
for (const made of (list => ('a1b1'.replace(/(9)?1/g, ((match: string, group: any) => (list.push(new Group(group)), '')) as any), list))([] as Group[])) said.push(`Group ${made.held} ${made.twice()}`);
for (const made of (list => (new Map<number, any>([[1, undefined], [2, 3]]).forEach((value: any) => list.push(new MapValue(value))), list))([] as MapValue[])) said.push(`MapValue ${made.held} ${made.twice()}`);
for (const made of (list => (new Map([[1, 2], [3, 4]]).forEach(((value: number, key: number, map: unknown, fourth: any) => list.push(new MapFourthOfMap(fourth))) as any), list))([] as MapFourthOfMap[])) said.push(`MapFourthOfMap ${made.held} ${made.twice()}`);
for (const made of (list => (new Uint8Array(2).forEach(((item: number, index: number, view: unknown, fourth: any) => list.push(new ViewFourth(fourth))) as any), list))([] as ViewFourth[])) said.push(`ViewFourth ${made.held} ${made.twice()}`);
for (const made of await new Promise<Timer[]>(resolve => setTimeout(((first: number, second: any) => resolve([new Timer(second), new Timer(first)])) as any, 0, 1))) said.push(`Timer ${made.held} ${made.twice()}`);
for (const made of await Promise.resolve(1).then(((value: number, second: any) => [new Then(second), new Then(value)]) as any) as Then[]) said.push(`Then ${made.held} ${made.twice()}`);
class Index {
  constructor(public held: number) {}
  twice() {
    return this.held * 2;
  }
}
for (const made of Array.from({ length: 3 }, (item: unknown, index: number) => new Index(index))) said.push(`Index ${made.held} ${made.twice()}`);
console.log(said.join("\n"));
