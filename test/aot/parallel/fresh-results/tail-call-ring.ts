// Tail calls that lead back to where they began do not grow the stack, also where the call that ends them returns a new object.
export {};

type Count = { steps: number; isEven: boolean };

function even(n: number, steps: number): Count {
  if (n === 0) return { steps, isEven: true };
  return odd(n - 1, steps + 1);
}

function odd(n: number, steps: number): Count {
  if (n === 0) return { steps, isEven: false };
  return even(n - 1, steps + 1);
}

function countDown(n: number, steps: number): Count {
  if (n === 0) return { steps, isEven: steps % 2 === 0 };
  return countDown(n - 1, steps + 1);
}

// It stands on no ring itself.
function start(n: number): Count {
  return even(n, 0);
}

const kept: Count[] = [];

// The ring leads through a function that keeps one of the objects it returns, so not all that comes round is new.
function ping(n: number, steps: number): Count {
  if (n === 0) return { steps, isEven: true };
  return pong(n - 1, steps + 1);
}

function pong(n: number, steps: number): Count {
  if (n === 1) {
    const made = ping(0, steps + 1);
    kept.push(made);
    return made;
  }
  return ping(n - 1, steps + 1);
}

const spare: Count = { steps: -1, isEven: false };

// Beside a new object it returns one that everybody sees, and what it calls in tail position is a value that it was handed.
function hop(n: number, steps: number, next: (n: number, steps: number, next: never) => Count): Count {
  if (n < 0) return spare;
  if (n === 0) return { steps, isEven: steps % 2 === 0 };
  return next(n - 1, steps + 1, next as never);
}

const a = start(1_000_001);
const b = odd(1_000_000, 0);
const c = countDown(1_000_000, 0);
console.log(a.steps, a.isEven, b.steps, b.isEven, c.steps, c.isEven);

const d = ping(1_000_000, 0);
console.log(d.steps, d.isEven, kept.length, kept[0] === d);

const e = hop(1_000_000, 0, hop as never);
console.log(e.steps, e.isEven, hop(-1, 0, hop as never) === spare);
