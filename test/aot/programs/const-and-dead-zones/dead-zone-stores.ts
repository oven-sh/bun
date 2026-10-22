// A store before a `let` is initialized throws, at module level and in a closure's environment. After initialization it succeeds.
function attempt(run: () => unknown): unknown {
  try {
    return run();
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

function storeEarly(): number {
  moduleLevel = 1;
  return 1;
}
function readEarly(): number {
  return moduleLevel;
}
console.log(attempt(storeEarly), attempt(readEarly));
try {
  // @ts-ignore
  moduleLevel = 2;
} catch (error) {
  console.log((error as Error).constructor.name);
}
let moduleLevel: number = 3;
console.log(moduleLevel, attempt(readEarly), attempt(storeEarly), moduleLevel);

function inEnvironment(): unknown[] {
  const store = (): number => {
    captured = 10;
    return captured;
  };
  const read = (): number => captured;
  const before = [attempt(store), attempt(read)];
  let captured: number = 20;
  const after = [attempt(read), attempt(store), captured];
  return [before, after];
}
console.log(JSON.stringify(inEnvironment()));

function directlyInEnvironment(): unknown[] {
  const read = (): string => captured;
  let result: unknown;
  try {
    // @ts-ignore
    captured = "early";
  } catch (error) {
    result = (error as Error).constructor.name;
  }
  let captured: string = "late";
  return [result, read()];
}
console.log(JSON.stringify(directlyInEnvironment()));

function constantInEnvironment(): unknown[] {
  const read = (): number => fixed;
  const before = attempt(read);
  const fixed: number = 5;
  return [before, attempt(read)];
}
console.log(JSON.stringify(constantInEnvironment()));

function storedThroughCallee(): unknown[] {
  const results: unknown[] = [];
  const store = (value: number): void => {
    counter = value;
  };
  for (let round = 0; round < 2; round++) results.push(attempt(() => store(round)));
  let counter: number = 0;
  for (let round = 0; round < 2; round++) {
    store(round + 1);
    results.push(counter);
  }
  return results;
}
console.log(JSON.stringify(storedThroughCallee()));
