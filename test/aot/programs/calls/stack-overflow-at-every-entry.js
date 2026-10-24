let limit = Infinity;

function direct(depth) {
  return depth >= limit ? 0 : depth + direct(depth + 1);
}

function createClosure() {
  const closure = depth => (depth >= limit ? 0 : depth + closure(depth + 1));
  return closure;
}

const methodTarget = {
  sum(depth) {
    return depth >= limit ? 0 : depth + this.sum(depth + 1);
  },
};

const getterTarget = {
  depth: 0,
  get sum() {
    const depth = this.depth;
    if (depth >= limit) return 0;
    this.depth = depth + 1;
    return depth + this.sum;
  },
};

function throughGetter() {
  getterTarget.depth = 0;
  return getterTarget.sum;
}

function throughMap(depth) {
  return depth >= limit ? 0 : [depth].map(value => value + throughMap(value + 1))[0];
}

class Chain {
  constructor(depth) {
    this.sum = depth >= limit ? 0 : depth + new Chain(depth + 1).sum;
  }
}

async function throughAsync(depth) {
  return depth >= limit ? 0 : depth + (await throughAsync(depth + 1));
}

async function check(name, run) {
  limit = Infinity;
  try {
    console.log(name, "returned", await run());
  } catch (error) {
    console.log(name, error.name);
  }
  limit = 3;
  console.log(name, "depth 3:", await run());
  limit = 1000;
  console.log(name, "depth 1000:", await run());
}

async function main() {
  const closure = createClosure();
  await check("direct", () => direct(0));
  await check("closure", () => closure(0));
  await check("method", () => methodTarget.sum(0));
  await check("getter", throughGetter);
  await check("map", () => throughMap(0));
  await check("new", () => new Chain(0).sum);
  await check("async", () => throughAsync(0));
}

main();
