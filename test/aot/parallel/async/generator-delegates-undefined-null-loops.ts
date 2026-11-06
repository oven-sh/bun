// Generators delegate to undefined or null. Loops over lists stand behind the delegation, in front of it, around it and in its handlers.
function show(value: unknown): void {
  console.log(value);
}

function listOf(text: string): number[] {
  return JSON.parse(text);
}

function nothing(): undefined {
  return undefined;
}

function drain(name: string, made: Iterable<unknown>): void {
  try {
    for (const value of made) console.log(name, "yields", value);
    console.log(name, "ends");
  } catch (error) {
    console.log(name, "throws", (error as Error).name);
  }
}

function* loopBehind(list: number[]) {
  yield* undefined as any;
  for (const element of list) show(element);
}

function* loopInFrontAndDelegationBehind(list: number[], more: number[]) {
  for (const element of list) show(element);
  yield* null as any;
  yield* more;
}

function* loopsOnBothSides(list: number[], more: number[]) {
  for (const element of list) show(element);
  yield* undefined as any;
  for (const element of more) show(element);
}

function* answerOfACall(list: number[]) {
  yield* nothing() as any;
  for (const element of list) show(element);
}

function* onOnePath(list: number[], delegates: boolean) {
  if (delegates) yield* null as any;
  for (const element of list) show(element);
}

function* insideALoop(list: number[]) {
  for (const element of list) {
    show(element);
    yield* undefined as any;
    for (const inner of list) show(inner);
  }
}

function* caught(list: number[]) {
  try {
    yield* undefined as any;
    for (const element of list) show(element);
  } catch (error) {
    show((error as Error).name);
  }
  for (const element of list) show(element);
  yield* list;
}

function* caughtByTheOuterOfTwo(list: number[]) {
  try {
    try {
      yield* null as any;
      for (const element of list) show(element);
    } finally {
      for (const element of list) show(element);
    }
  } catch (error) {
    show((error as Error).name);
  }
  yield* list;
}

function* loopThatLeavesEarlyBehind(list: number[]) {
  yield* undefined as any;
  for (const element of list) {
    show(element);
    if (element > 1) break;
  }
}

drain("loopBehind", loopBehind(listOf("[1,2]")));
drain("loopInFrontAndDelegationBehind", loopInFrontAndDelegationBehind(listOf("[1,2]"), listOf("[3]")));
drain("loopsOnBothSides", loopsOnBothSides(listOf("[1,2]"), listOf("[3]")));
drain("answerOfACall", answerOfACall(listOf("[1,2]")));
drain("onOnePath", onOnePath(listOf("[1,2]"), true));
drain("onOnePath", onOnePath(listOf("[1,2]"), false));
drain("insideALoop", insideALoop(listOf("[1,2]")));
drain("caught", caught(listOf("[1,2]")));
drain("caughtByTheOuterOfTwo", caughtByTheOuterOfTwo(listOf("[1,2]")));
drain("loopThatLeavesEarlyBehind", loopThatLeavesEarlyBehind(listOf("[1,2,3]")));
