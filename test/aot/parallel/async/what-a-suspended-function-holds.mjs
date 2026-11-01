// What a suspended function holds, asked while it is suspended: what it reads behind the suspension, its parameters and its receiver.
let last;
let asking = false;
let sink = 0;
function watched(value) {
  last = new WeakRef(value);
  return value;
}
function make(n) {
  return watched({ n });
}
function use(value) {
  sink += value.n;
}
async function pause(label) {
  if (!asking) return 1;
  for (let round = 0; round < 4; round++) {
    await new Promise(resolve => setTimeout(resolve, 1));
    Bun.gc(true);
  }
  console.log(label + ":", last.deref() !== undefined ? "kept" : "collected");
  return 1;
}
async function tick() {
  if (asking) await new Promise(resolve => setTimeout(resolve, 1));
}

const forms = [];
function form(run) {
  forms.push(run);
}

form(async function localReadBehind(n) {
  const x = make(n);
  await pause("a local read behind the await");
  return x.n;
});
form(async function localNotReadBehind(n) {
  const x = make(n);
  use(x);
  await pause("a local read only in front of the await");
  return 1;
});
form(async function localNeverRead(n) {
  const x = make(n);
  await pause("a local nobody reads");
  return 1;
});
form(async function temporary(n) {
  return [make(n), await pause("an operand that waits for the await")].length;
});
form(async function readInFinally(n) {
  const x = make(n);
  try {
    await pause("a local read in the finally block");
  } finally {
    use(x);
  }
  return 1;
});
form(async function readInCatch(n) {
  const x = make(n);
  try {
    await pause("a local read in the catch block");
  } catch {
    use(x);
  }
  return 1;
});
form(async function localOfATry(n) {
  try {
    const x = make(n);
    use(x);
    await pause("a local of a try block read only in front");
  } finally {
    sink++;
  }
  return 1;
});
form(async function resultBehindFinally(n) {
  const made = await (async () => {
    try {
      return { x: make(n), m: await pause("a member of a result that waits for the await, in a try with a finally") };
    } finally {
      sink++;
    }
  })();
  return made.m;
});

async function parameterNamedInFront(p) {
  use(p);
  await pause("a parameter named only in front of the await");
  return 1;
}
form(n => parameterNamedInFront(make(n)));
async function parameterNeverNamed(p) {
  await pause("a parameter nobody names");
  return 1;
}
form(n => parameterNeverNamed(make(n)));
async function parameterNamedBehind(p) {
  await pause("a parameter named behind the await");
  return p.n;
}
form(n => parameterNamedBehind(make(n)));
async function destructuredMember({ inner }) {
  use(inner);
  await pause("a name of a destructured parameter, named only in front");
  return 1;
}
form(n => destructuredMember({ inner: make(n) }));
async function restParameter(...rest) {
  sink += rest.length;
  await pause("a member of a rest parameter named only in front");
  return 1;
}
form(n => restParameter(make(n)));
const arrowParameter = async p => {
  use(p);
  await pause("a parameter of an arrow function named only in front");
  return 1;
};
form(n => arrowParameter(make(n)));
class Receiver {
  constructor(n) {
    this.n = n;
  }
  async namesThisInFront() {
    use(this);
    await pause("`this` named only in front");
    return 1;
  }
  async neverNamesThis() {
    await pause("`this` nobody names");
    return 1;
  }
}
form(n => watched(new Receiver(n)).namesThisInFront());
form(n => watched(new Receiver(n)).neverNamesThis());

form(async function capturedByADeadClosure(n) {
  const x = make(n);
  const read = () => x.n;
  sink += read();
  await pause("a variable of a closure that is called only in front");
  return 1;
});
form(async function capturedInABlock(n) {
  {
    const x = make(n);
    const read = () => x.n;
    sink += read();
  }
  await pause("a variable of a closure of a block that has ended");
  return 1;
});
form(async function holderReadInPart(n) {
  const holder = { read: n, kept: make(n) };
  await pause("a member nobody reads of a literal read behind");
  return holder.read;
});
form(async function holderInAHolder(n) {
  const holder = { read: n, inner: { kept: make(n) } };
  await pause("a member of a member of a literal read behind");
  return holder.read;
});
form(async function memberReplaced(n) {
  const holder = { read: n, kept: make(n) };
  await tick();
  holder.kept = null;
  await pause("a member that was replaced since");
  return holder.read;
});
form(async function memberStoredBehind(n) {
  const holder = { read: n, kept: null };
  await tick();
  holder.kept = make(n);
  await pause("a member stored between two awaits");
  return holder.read;
});

function* generatorLocalReadBehind(n) {
  const x = make(n);
  yield 1;
  return x.n;
}
function* generatorLocalNotReadBehind(n) {
  const x = make(n);
  use(x);
  yield 1;
  return 1;
}
function* generatorParameterNamedInFront(p) {
  use(p);
  yield 1;
  return 1;
}
function* generatorParameterNeverNamed(p) {
  yield 1;
  return 1;
}
function* generatorNotStarted(p) {
  yield p.n;
}
function* generatorNotStartedNeverNamed(p) {
  yield 1;
}
function* generatorHolder(n) {
  const holder = { read: n, kept: make(n) };
  yield 1;
  return holder.read;
}
function stepped(label, steps, start) {
  form(async n => {
    const generator = start(n);
    for (let i = 0; i < steps; i++) generator.next();
    await pause(label);
    return generator.next().done;
  });
}
stepped("generator: a local read behind the yield", 1, n => generatorLocalReadBehind(n));
stepped("generator: a local read only in front of the yield", 1, n => generatorLocalNotReadBehind(n));
stepped("generator: a parameter named only in front", 1, n => generatorParameterNamedInFront(make(n)));
stepped("generator: a parameter nobody names", 1, n => generatorParameterNeverNamed(make(n)));
stepped("generator: a parameter of one that has not started", 0, n => generatorNotStarted(make(n)));
stepped("generator: a parameter nobody names of one that has not started", 0, n =>
  generatorNotStartedNeverNamed(make(n)),
);
stepped("generator: a member nobody reads of a literal read behind", 1, n => generatorHolder(n));

async function* asyncGeneratorLocals(n) {
  const x = make(n);
  const holder = { read: n, kept: x };
  yield 1;
  return holder.read;
}
async function* asyncGeneratorNotReadBehind(n) {
  const x = make(n);
  use(x);
  yield 1;
  return 1;
}
async function* asyncGeneratorAwaits(n) {
  const holder = { read: n, kept: make(n) };
  await pause("async generator: a member nobody reads of a literal read behind an await");
  yield holder.read;
}
async function* asyncGeneratorParameter(p) {
  use(p);
  yield 1;
  return 1;
}
function asyncStepped(label, start) {
  form(async n => {
    const generator = start(n);
    await generator.next();
    await pause(label);
    return (await generator.next()).done;
  });
}
asyncStepped("async generator: a member nobody reads of a literal read behind a yield", n => asyncGeneratorLocals(n));
asyncStepped("async generator: a local read only in front of the yield", n => asyncGeneratorNotReadBehind(n));
asyncStepped("async generator: a parameter named only in front", n => asyncGeneratorParameter(make(n)));
form(async n => (await asyncGeneratorAwaits(n).next()).value);

form(async function forAwait(n) {
  const holder = { read: n, kept: make(n) };
  async function* source() {
    await pause("a member nobody reads of a literal read behind a for-await loop");
    yield 1;
  }
  for await (const step of source()) sink += step;
  return holder.read;
});

for (const run of forms) for (let i = 0; i < 3; i++) await run(i);
asking = true;
for (const run of forms) await run(1);
/* Output:
a local read behind the await: kept
a local read only in front of the await: collected
a local nobody reads: collected
an operand that waits for the await: kept
a local read in the finally block: kept
a local read in the catch block: kept
a local of a try block read only in front: collected
a member of a result that waits for the await, in a try with a finally: kept
a parameter named only in front of the await: kept
a parameter nobody names: kept
a parameter named behind the await: kept
a name of a destructured parameter, named only in front: kept
a member of a rest parameter named only in front: kept
a parameter of an arrow function named only in front: kept
`this` named only in front: kept
`this` nobody names: kept
a variable of a closure that is called only in front: collected
a variable of a closure of a block that has ended: collected
a member nobody reads of a literal read behind: kept
a member of a member of a literal read behind: kept
a member that was replaced since: collected
a member stored between two awaits: kept
generator: a local read behind the yield: kept
generator: a local read only in front of the yield: collected
generator: a parameter named only in front: kept
generator: a parameter nobody names: kept
generator: a parameter of one that has not started: kept
generator: a parameter nobody names of one that has not started: kept
generator: a member nobody reads of a literal read behind: kept
async generator: a member nobody reads of a literal read behind a yield: kept
async generator: a local read only in front of the yield: collected
async generator: a parameter named only in front: kept
async generator: a member nobody reads of a literal read behind an await: kept
a member nobody reads of a literal read behind a for-await loop: kept
*/
