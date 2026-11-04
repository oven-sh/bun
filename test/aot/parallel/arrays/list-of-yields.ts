// A list of more than 32 yields takes each value when it is sent. A caller may end the generator at any of the yields, or go on behind one that it has ended.
type Steps = Generator<number, unknown, unknown>;

function* plain(): Steps {
  // prettier-ignore
  return [
    yield 0, yield 1, yield 2, yield 3, yield 4, yield 5, yield 6, yield 7, yield 8, yield 9,
    yield 10, yield 11, yield 12, yield 13, yield 14, yield 15, yield 16, yield 17, yield 18, yield 19,
    yield 20, yield 21, yield 22, yield 23, yield 24, yield 25, yield 26, yield 27, yield 28, yield 29,
    yield 30, yield 31, yield 32, yield 33, yield 34, yield 35, yield 36, yield 37, yield 38, yield 39,
  ];
}

function* withHolesAndChoices(skips: boolean): Steps {
  // prettier-ignore
  return [
    yield 0, , yield 1, skips ? "skipped" : yield 2, yield 3, yield 4, yield 5, yield 6, yield 7, yield 8, yield 9,
    yield 10, yield 11, yield 12, yield 13, yield 14, yield 15, yield 16, yield 17, , , yield 18, yield 19,
    yield 20, yield 21, yield 22, yield 23, skips ? yield 24 : "left out", yield 25, yield 26, yield 27, yield 28, yield 29,
    yield 30, yield 31, yield 32, yield 33, yield 34, yield 35, yield 36, yield 37, yield 38, yield 39, ,
  ];
}

function* begunAgain(): Steps {
  const log: string[] = [];
  for (let turn = 0; turn < 3; turn++) {
    try {
      // prettier-ignore
      const list = [
        yield 0, yield 1, yield 2, yield 3, yield 4, yield 5, yield 6, yield 7, yield 8, yield 9,
        yield 10, yield 11, yield 12, yield 13, yield 14, yield 15, yield 16, yield 17, yield 18, yield 19,
        yield 20, yield 21, yield 22, yield 23, yield 24, yield 25, yield 26, yield 27, yield 28, yield 29,
        yield 30, yield 31, yield 32, yield 33, yield 34, yield 35, yield 36, yield 37, yield 38, yield 39,
      ];
      log.push(turn + " lists " + list.join());
    } catch (error) {
      log.push(turn + " caught " + String(error));
    } finally {
      log.push(turn + " is over");
      if (turn < 2) continue;
    }
  }
  return log;
}

function send(steps: Steps, count: number, mark: string) {
  let step = steps.next();
  for (let sent = 0; sent < count && !step.done; sent++) step = steps.next(mark + sent);
  return step;
}

console.log(JSON.stringify(send(plain(), 40, "s")));
const holed = send(withHolesAndChoices(false), 40, "h");
console.log(JSON.stringify(holed), 1 in (holed.value as unknown[]));
console.log(JSON.stringify(send(withHolesAndChoices(true), 40, "c")));

for (const count of [0, 1, 17, 39]) {
  const returned = plain();
  send(returned, count, "r");
  console.log(count, JSON.stringify(returned.return("returned")), JSON.stringify(returned.next("late")));

  const thrown = plain();
  send(thrown, count, "t");
  try {
    thrown.throw(new Error("thrown at " + count));
  } catch (error) {
    console.log(count, String(error), JSON.stringify(thrown.next("late")));
  }
}

const first = plain();
const second = plain();
let ofFirst = first.next();
let ofSecond = second.next();
for (let sent = 0; sent < 40; sent++) {
  ofFirst = first.next("a" + sent);
  ofSecond = second.next({ sent });
}
console.log(ofFirst.value === ofSecond.value, JSON.stringify(ofFirst.value), JSON.stringify(ofSecond.value));

const again = begunAgain();
send(again, 5, "x");
console.log(JSON.stringify(again.return("ended in the first turn")));
for (let sent = 0; sent < 12; sent++) again.next("y" + sent);
console.log(JSON.stringify(again.throw("thrown in the second turn")));
let last = again.next("z");
for (let sent = 0; !last.done; sent++) last = again.next("z" + sent);
console.log(JSON.stringify(last, null, 1));
