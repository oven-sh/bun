// IR= 2 logsItsOrder NewArray(Like|WithCapacity)
// IR= 2 countsItsCalls NewArray(Like|WithCapacity)
// IR= 2 writesWhatTheNextReads NewArray(Like|WithCapacity)
// IR= 2 takesTheIndex NewArray(Like|WithCapacity)
// IR= 2 takesTheArray NewArray(Like|WithCapacity)
// IR= 2 callsWhatItIsGiven NewArray(Like|WithCapacity)
// IR= 2 hasALoop NewArray(Like|WithCapacity)
// IR= 2 hasAReceiver NewArray(Like|WithCapacity)
// IR= 2 changesTheElements NewArray(Like|WithCapacity)
// IR= 2 changesTheArray NewArray(Like|WithCapacity)
// IR= 2 readsWhatMayBeNull NewArray(Like|WithCapacity)
// IR= 2 throwsByItself NewArray(Like|WithCapacity)
// IR= 2 throwsBetweenTheCalls NewArray(Like|WithCapacity)
interface Owner {
  name: string;
}
interface Sale {
  customer: number;
  amount: number;
  owner: Owner | null;
}
function someSales(): Sale[] {
  const sales: Sale[] = [];
  for (let i = 0; i < 5; i++) sales.push({ customer: i, amount: i * 3, owner: i === 3 ? null : { name: "o" + i } });
  return sales;
}
const sales = someSales();
const log: string[] = [];
let calls = 0;

function logsItsOrder(list: Sale[]): number[] {
  let last: number[] = [];
  for (let round = 0; round < 2; round++) {
    last = list
      .filter(o => {
        log.push("f" + o.customer);
        return o.amount > 0;
      })
      .map(o => {
        log.push("m" + o.customer);
        return o.amount;
      });
  }
  return last;
}
function countsItsCalls(list: Sale[]): number {
  let total = 0;
  for (let round = 0; round < 2; round++) total += list.filter(o => o.amount > ++calls).map(o => o.amount + ++calls).reduce((sum, x) => sum + x, 0);
  return total;
}
function writesWhatTheNextReads(list: Sale[]): number[] {
  let last: number[] = [];
  for (let round = 0; round < 2; round++) {
    let seen = 0;
    last = list
      .filter(o => {
        seen += 1;
        return o.amount > 0;
      })
      .map(o => o.amount + seen);
  }
  return last;
}
function takesTheIndex(list: Sale[]): number[] {
  let last: number[] = [];
  for (let round = 0; round < 2; round++) last = list.filter(o => o.amount > 0).map((o, index) => o.amount * 10 + index);
  return last;
}
function takesTheArray(list: Sale[]): number[] {
  let last: number[] = [];
  for (let round = 0; round < 2; round++) last = list.filter(o => o.amount > 0).map((o, _index, all) => o.amount + all.length);
  return last;
}
function usedTwice(list: Sale[]): number {
  let total = 0;
  for (let round = 0; round < 2; round++) {
    const kept = list.filter(o => o.amount > 3);
    total += kept.map(o => o.amount).length + kept.length;
  }
  return total;
}
function callsWhatItIsGiven(list: Sale[], weigh: (o: Sale) => number): number[] {
  let last: number[] = [];
  for (let round = 0; round < 2; round++) last = list.filter(o => o.amount > 0).map(o => weigh(o));
  return last;
}
function hasALoop(list: Sale[]): number[] {
  let last: number[] = [];
  for (let round = 0; round < 2; round++) {
    last = list
      .filter(o => o.amount > 0)
      .map(o => {
        let sum = 0;
        for (let i = 0; i < o.customer; i++) sum += i;
        return sum;
      });
  }
  return last;
}
function hasAReceiver(list: Sale[], limits: { least: number }): number[] {
  let last: number[] = [];
  for (let round = 0; round < 2; round++) {
    last = list
      .filter(function (this: { least: number }, o) {
        return o.amount > this.least;
      }, limits)
      .map(o => o.amount);
  }
  return last;
}
function changesTheElements(list: Sale[]): number[] {
  let last: number[] = [];
  for (let round = 0; round < 2; round++) {
    last = list
      .filter(o => {
        o.amount += 1;
        return o.amount > 2;
      })
      .map(o => o.amount + list[list.length - 1]!.amount);
  }
  return last;
}
function changesTheArray(list: Sale[]): number[] {
  let last: number[] = [];
  for (let round = 0; round < 2; round++) {
    last = list
      .filter(o => {
        if (list.length > 3) list.pop();
        return o.amount >= 0;
      })
      .map(o => o.amount + list.length);
  }
  return last;
}
function readsWhatMayBeNull(list: Sale[]): string[] {
  let last: string[] = [];
  for (let round = 0; round < 2; round++) last = list.filter(o => o.amount >= 0).map(o => o.owner!.name);
  return last;
}
function throwsByItself(list: Sale[]): number[] {
  let last: number[] = [];
  for (let round = 0; round < 2; round++) {
    last = list
      .filter(o => o.amount >= 0)
      .map(o => {
        if (o.customer === 2) throw new RangeError("two");
        return o.amount;
      });
  }
  return last;
}
function throwsBetweenTheCalls(list: Sale[]): string {
  const seen: number[] = [];
  try {
    for (let round = 0; round < 2; round++) {
      list
        .filter(o => {
          seen.push(o.customer);
          return true;
        })
        .map(o => o.owner!.name.length)
        .reduce((sum, x) => sum + x, 0);
    }
  } catch (error) {
    return (error as Error).constructor.name + " after " + seen.join();
  }
  return "nothing thrown";
}
function capturesTheIntermediateArray(list: Sale[]): number {
  let total = 0;
  for (let round = 0; round < 2; round++) {
    const kept = list.filter(o => o.amount > 3);
    const size = () => kept.length;
    total += size();
  }
  return total;
}

console.log(logsItsOrder(sales).join(), log.join());
console.log(countsItsCalls(sales), calls, writesWhatTheNextReads(sales).join());
console.log(takesTheIndex(sales).join(), takesTheArray(sales).join(), usedTwice(sales), capturesTheIntermediateArray(sales));
console.log(
  callsWhatItIsGiven(sales, o => {
    log.push("w" + o.customer);
    return o.amount * 2;
  }).join(),
  log.length,
);
console.log(hasALoop(sales).join(), hasAReceiver(sales, { least: 5 }).join());
console.log(changesTheElements(someSales()).join(), changesTheArray(someSales()).join(), throwsBetweenTheCalls(sales));
for (const run of [readsWhatMayBeNull, throwsByItself]) {
  try {
    console.log(run(sales).join());
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
}
