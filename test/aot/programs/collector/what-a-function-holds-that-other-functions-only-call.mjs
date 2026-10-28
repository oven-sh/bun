// Forty scopes a row. One function of the scope captures an object that a WeakRef knows, and is only ever called: by a declared function of the scope, by other functions of the scope that capture it, and by functions that it is handed to.
// The object is there for as long as the scope is, for as long as a function that captures such a function is, and for as long as a function that calls one behind an await is suspended.
const kept = [];
const rows = [];
function row(name, make) {
  const weak = [];
  for (let n = 0; n < 40; n++) kept.push(make(n, weak));
  rows.push({ name, weak });
}
const watched = (weak, value) => (weak.push(new WeakRef(value)), value);

row("called by two functions, by one of them through the other", (n, weak) => {
  function scope(held, extra) {
    let calls = 0;
    const reads = scale => {
      let total = 0;
      calls++;
      for (let i = 0; i < scale; i++) {
        try {
          if (held.n < 0) throw new RangeError("negative");
          total += held.n + extra;
        } catch (error) {
          total -= error.message.length;
        }
      }
      return total;
    };
    const once = limit => {
      let total = 0;
      for (let i = 0; i < 2; i++) {
        try {
          if (limit > 1e6) throw new RangeError("large");
          total += reads(1 + i);
        } catch (error) {
          total -= error.message.length;
        }
      }
      return total;
    };
    const either = twice => {
      let total = 0;
      for (let i = 0; i < 2; i++) {
        try {
          total += twice ? once(i) + reads(2) : once(i);
        } catch (error) {
          total -= error.message.length;
        }
      }
      return total;
    };
    function entry() {
      return either(extra % 2 === 0) + once(3) + reads(1) + calls;
    }
    return entry;
  }
  return scope(watched(weak, { n }), n);
});

function callsWhatItIsGiven(called, scale) {
  let total = 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called(scale + i);
    } catch (error) {
      total -= error.message.length;
    }
  }
  return total;
}
function callsIfGiven(called, scale) {
  let total = 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called ? called(scale + i) : scale;
    } catch (error) {
      total -= error.message.length;
    }
  }
  return total;
}
const leftBehind = [];
for (const [name, form] of [
  ["handed to a function that calls it", 0],
  ["handed to a function that may get nothing", 1],
  ["captured by a function that leaves", 2],
  ["called by one function and handed out by another", 3],
]) {
  row(name, (n, weak) => {
    function scope(held) {
      let calls = 0;
      const reads = scale => {
        let total = 0;
        calls++;
        for (let i = 0; i < scale; i++) {
          try {
            if (held.n < 0) throw new RangeError("negative");
            total += held.n;
          } catch (error) {
            total -= error.message.length;
          }
        }
        return total;
      };
      const uses = limit => {
        let total = 0;
        for (let i = 0; i < 2; i++) {
          try {
            if (limit > 1e6) throw new RangeError("large");
            total +=
              form === 0
                ? callsWhatItIsGiven(reads, i)
                : form === 1
                  ? callsIfGiven(reads, i) + callsIfGiven(undefined, i)
                  : reads(i);
          } catch (error) {
            total -= error.message.length;
          }
        }
        return total;
      };
      const handsOut = () => reads;
      function entry() {
        return uses(1) + reads(1) + calls;
      }
      if (form === 3) leftBehind.push(handsOut);
      return form === 2 ? uses : entry;
    }
    return scope(watched(weak, { n }));
  });
}

function capturesWhatItIsGiven(called) {
  let calls = 0;
  function inner(scale) {
    let total = 0;
    calls++;
    for (let i = 0; i < 2; i++) {
      try {
        if (scale > 1e6) throw new RangeError("large");
        total += called(scale + i);
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  }
  function entry() {
    return inner(1) + inner(2) + calls;
  }
  return entry;
}
row("handed to a function whose own functions capture it", (n, weak) => {
  function scope(held) {
    let calls = 0;
    function reads(scale) {
      let total = 0;
      calls++;
      for (let i = 0; i < scale; i++) {
        try {
          if (held.n < 0) throw new RangeError("negative");
          total += held.n;
        } catch (error) {
          total -= error.message.length;
        }
      }
      return total;
    }
    const other = capturesWhatItIsGiven(reads);
    function entry() {
      return other() + reads(1) + calls;
    }
    return entry;
  }
  return scope(watched(weak, { n }));
});

const pending = [];
const release = [];
function rowOfSuspended(name, make) {
  const weak = [];
  for (let n = 0; n < 40; n++) pending.push(make(n, weak, new Promise(resolve => release.push(resolve))));
  rows.push({ name, weak });
}
for (const [name, form] of [
  ["called behind an await through another", 0],
  ["handed on behind an await", 1],
  ["called in front of an await alone", 2],
]) {
  rowOfSuspended(name, async (n, weak, gate) => {
    const held = watched(weak, { n });
    let calls = 0;
    const reads = scale => {
      let total = 0;
      calls++;
      for (let i = 0; i < scale; i++) {
        try {
          if (held.n < 0) throw new RangeError("negative");
          total += held.n;
        } catch (error) {
          total -= error.message.length;
        }
      }
      return total;
    };
    const uses = limit => {
      let total = 0;
      for (let i = 0; i < 2; i++) {
        try {
          if (limit > 1e6) throw new RangeError("large");
          total += reads(i + 1);
        } catch (error) {
          total -= error.message.length;
        }
      }
      return total;
    };
    function entry() {
      return uses(1) + reads(1) + calls;
    }
    const early = form === 2 ? entry() : 0;
    await gate;
    return form === 0 ? uses(2) + entry() : form === 1 ? callsWhatItIsGiven(reads, 2) : early;
  });
}

async function collect() {
  for (let round = 0; round < 6; round++) {
    Bun.gc(true);
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}
await collect();
for (const { name, weak } of rows)
  console.log(`${name}: ${weak.filter(w => w.deref() !== undefined).length} of ${weak.length}`);
for (const resolve of release) resolve();
let sum = 0;
for (const value of await Promise.all(pending)) sum += value;
for (const call of kept) sum += call(1);
for (const handsOut of leftBehind) sum += handsOut()(2) + (handsOut() === handsOut() ? 1 : 0);
console.log("sum", sum);
