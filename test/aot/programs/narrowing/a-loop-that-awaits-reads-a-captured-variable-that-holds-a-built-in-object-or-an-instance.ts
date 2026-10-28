// Each loop tests a captured variable in every turn. The variable holds a built-in object at first, and an instance of a class in some calls.
async function functionOrRegExp(turn: number) {
  let value: typeof Math.max | RegExp = Math.max;
  const read = async () => {
    let result;
    for (let i = 0; i < 4; i++) {
      if (typeof value === "function") result = await value(i, 1);
      else result = value.flags;
    }
    return result;
  };
  if (turn % 20 === 7) value = /a/g;
  return read();
}

async function regExpOrFunction(turn: number) {
  let value: typeof Math.max | RegExp = /a/g;
  const read = async () => {
    let result;
    for (let i = 0; i < 4; i++) {
      if (typeof value === "function") result = await value(i, 1);
      else result = value.flags;
    }
    return result;
  };
  if (turn % 20 === 7) value = Math.max;
  return read();
}

async function constructorOrRegExp(turn: number) {
  let value: typeof Number | RegExp = Number;
  const read = async () => {
    let result;
    for (let i = 0; i < 4; i++) {
      if (typeof value === "function") result = await value(i);
      else result = value.source;
    }
    return result;
  };
  if (turn % 20 === 7) value = /b/;
  return read();
}

async function namespaceOrRegExp(turn: number) {
  let value: typeof Math | RegExp = Math;
  const read = async () => {
    let result;
    for (let i = 0; i < 4; i++) {
      if (value instanceof RegExp) result = value.flags;
      else result = await value.max(i, 1);
    }
    return result;
  };
  if (turn % 20 === 7) value = /a/y;
  return read();
}

async function functionOrArray(turn: number) {
  let value: typeof Math.max | number[] = Math.max;
  const read = async () => {
    let result;
    for (let i = 0; i < 4; i++) {
      if (typeof value === "function") result = await value(i, 1);
      else result = value.length + value[i % 2];
    }
    return result;
  };
  if (turn % 20 === 7) value = [turn, 2];
  return read();
}

async function functionOrMap(turn: number) {
  let value: typeof Math.max | Map<string, number> = Math.max;
  const read = async () => {
    let result;
    for (let i = 0; i < 4; i++) {
      if (typeof value === "function") result = await value(i, 1);
      else result = value.size + value.get("a")!;
    }
    return result;
  };
  if (turn % 20 === 7) value = new Map([["a", turn]]);
  return read();
}

async function functionOrDate(turn: number) {
  let value: typeof Math.max | Date = Math.max;
  const read = async () => {
    let result;
    for (let i = 0; i < 4; i++) {
      if (typeof value === "function") result = await value(i, 1);
      else result = value.getTime();
    }
    return result;
  };
  if (turn % 20 === 7) value = new Date(turn);
  return read();
}

for (let turn = 0; turn < 60; turn++) {
  console.log(
    turn,
    await functionOrRegExp(turn),
    await regExpOrFunction(turn),
    await constructorOrRegExp(turn),
    await namespaceOrRegExp(turn),
    await functionOrArray(turn),
    await functionOrMap(turn),
    await functionOrDate(turn),
  );
}
export {};
