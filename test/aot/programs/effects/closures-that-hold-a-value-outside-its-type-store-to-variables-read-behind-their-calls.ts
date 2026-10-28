// Calls closures that hold a value outside its declared type and store to variables of the function around them, and prints each variable as it is read behind the call.
function run(g: () => void): void {
  g();
}

function pastTheEndOnTheSpot(): number {
  const list: string[] = [];
  const s = list[0];
  list[0] = s + 0;
  let n = 1;
  (() => {
    n = 2;
    s;
  })();
  return n;
}
for (let i = 0; i < 1; i++) console.log("pastTheEndOnTheSpot", pastTheEndOnTheSpot());

function pastTheEndLater(): number {
  const list: string[] = [];
  const s = list[0];
  list[0] = s + 0;
  let n = 1;
  const g = () => {
    n = 2;
    s;
  };
  const before = n;
  g();
  return before * 10 + n;
}
for (let i = 0; i < 1; i++) console.log("pastTheEndLater", pastTheEndLater());

function pastTheEndInALoop(): number {
  const list: string[] = [];
  const s = list[0];
  list[0] = s + 0;
  let n = 1;
  for (let j = 0; j < 3; j++)
    (() => {
      n += j + 1;
      s;
    })();
  return n;
}
for (let i = 0; i < 1; i++) console.log("pastTheEndInALoop", pastTheEndInALoop());

function pastTheEndInATry(): number {
  const list: string[] = [];
  const s = list[0];
  list[0] = s + 0;
  let n = 1;
  try {
    (() => {
      n = 2;
      s;
      throw new Error("x");
    })();
  } catch {
    n += 10;
  }
  return n;
}
for (let i = 0; i < 1; i++) console.log("pastTheEndInATry", pastTheEndInATry());

function pastTheEndOutOfAList(): number {
  const list: string[] = [];
  const s = list[0];
  list[0] = s + 0;
  let n = 1;
  const fs = [
    () => {
      n = 2;
      s;
    },
  ];
  fs[0]();
  return n;
}
for (let i = 0; i < 1; i++) console.log("pastTheEndOutOfAList", pastTheEndOutOfAList());

function pastTheEndThroughAHelper(): number {
  const list: string[] = [];
  const s = list[0];
  list[0] = s + 0;
  let n = 1;
  run(() => {
    n = 2;
    s;
  });
  return n;
}
for (let i = 0; i < 1; i++) console.log("pastTheEndThroughAHelper", pastTheEndThroughAHelper());

function pastTheEndNested(): number {
  const list: string[] = [];
  const s = list[0];
  list[0] = s + 0;
  let n = 1;
  (() => {
    (() => {
      n = 2;
      s;
    })();
  })();
  return n;
}
for (let i = 0; i < 1; i++) console.log("pastTheEndNested", pastTheEndNested());

function pastTheEndTwoVariables(): number {
  const list: string[] = [];
  const s = list[0];
  list[0] = s + 0;
  let n = 1;
  let m = 5;
  (() => {
    n = 2;
    m = n + 1;
    s;
  })();
  return n * 10 + m;
}
for (let i = 0; i < 1; i++) console.log("pastTheEndTwoVariables", pastTheEndTwoVariables());

function pastTheEndUnderACondition(): number {
  const list: string[] = [];
  const s = list[0];
  list[0] = s + 0;
  let n = 1;
  const g = (c: boolean) => {
    if (c) n = 2;
    return s;
  };
  g(true);
  return n;
}
for (let i = 0; i < 1; i++) console.log("pastTheEndUnderACondition", pastTheEndUnderACondition());

function pastTheEndTwice(): number {
  const list: string[] = [];
  const s = list[0];
  list[0] = s + 0;
  let n = 1;
  const g = () => {
    n += 1;
    s;
  };
  g();
  const a = n;
  g();
  return a * 10 + n;
}
for (let i = 0; i < 1; i++) console.log("pastTheEndTwice", pastTheEndTwice());

function aNumberOnTheSpot(): number {
  const s: string = 5 as any;
  let n = 1;
  (() => {
    n = 2;
    s;
  })();
  return n;
}
for (let i = 0; i < 1; i++) console.log("aNumberOnTheSpot", aNumberOnTheSpot());

function aNumberLater(): number {
  const s: string = 5 as any;
  let n = 1;
  const g = () => {
    n = 2;
    s;
  };
  const before = n;
  g();
  return before * 10 + n;
}
for (let i = 0; i < 1; i++) console.log("aNumberLater", aNumberLater());

function aNumberInALoop(): number {
  const s: string = 5 as any;
  let n = 1;
  for (let j = 0; j < 3; j++)
    (() => {
      n += j + 1;
      s;
    })();
  return n;
}
for (let i = 0; i < 1; i++) console.log("aNumberInALoop", aNumberInALoop());

function aNumberInATry(): number {
  const s: string = 5 as any;
  let n = 1;
  try {
    (() => {
      n = 2;
      s;
      throw new Error("x");
    })();
  } catch {
    n += 10;
  }
  return n;
}
for (let i = 0; i < 1; i++) console.log("aNumberInATry", aNumberInATry());

function aNumberOutOfAList(): number {
  const s: string = 5 as any;
  let n = 1;
  const fs = [
    () => {
      n = 2;
      s;
    },
  ];
  fs[0]();
  return n;
}
for (let i = 0; i < 1; i++) console.log("aNumberOutOfAList", aNumberOutOfAList());

function aNumberThroughAHelper(): number {
  const s: string = 5 as any;
  let n = 1;
  run(() => {
    n = 2;
    s;
  });
  return n;
}
for (let i = 0; i < 1; i++) console.log("aNumberThroughAHelper", aNumberThroughAHelper());

function aNumberNested(): number {
  const s: string = 5 as any;
  let n = 1;
  (() => {
    (() => {
      n = 2;
      s;
    })();
  })();
  return n;
}
for (let i = 0; i < 1; i++) console.log("aNumberNested", aNumberNested());

function aNumberTwoVariables(): number {
  const s: string = 5 as any;
  let n = 1;
  let m = 5;
  (() => {
    n = 2;
    m = n + 1;
    s;
  })();
  return n * 10 + m;
}
for (let i = 0; i < 1; i++) console.log("aNumberTwoVariables", aNumberTwoVariables());

function aNumberUnderACondition(): number {
  const s: string = 5 as any;
  let n = 1;
  const g = (c: boolean) => {
    if (c) n = 2;
    return s;
  };
  g(true);
  return n;
}
for (let i = 0; i < 1; i++) console.log("aNumberUnderACondition", aNumberUnderACondition());

function aNumberTwice(): number {
  const s: string = 5 as any;
  let n = 1;
  const g = () => {
    n += 1;
    s;
  };
  g();
  const a = n;
  g();
  return a * 10 + n;
}
for (let i = 0; i < 1; i++) console.log("aNumberTwice", aNumberTwice());

class Plain {
  m(): void {}
}
function methodOfAnotherObject(): number {
  let n = 1;
  const o: Plain = {
    m() {
      n = 2;
    },
  } as any;
  o.m();
  return n;
}
for (let i = 0; i < 1; i++) console.log("methodOfAnotherObject", methodOfAnotherObject());
