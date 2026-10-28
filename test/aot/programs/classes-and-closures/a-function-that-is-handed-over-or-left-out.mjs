// A function of a scope is handed to functions outside the scope that take it or undefined. Each of them asks in its own way whether it came, and calls it, hands it on, or does something with it that needs the function itself.
// Every scope has functions of its own to hand its function to, and each of those also hands it to itself.
const lines = [];
const say = (name, value) => lines.push(`${name}: ${value}`);

// Over the variables of the scope alone.
function asksByTruth(called, scale) {
  let total = scale > 0 ? asksByTruth(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called ? called(scale + i) : 1;
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function askedByTruth(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return asksByTruth(bump, 1) + asksByTruth(undefined, 1) + asksByTruth(void 0, 2) + count;
}
say("askedByTruth", askedByTruth(1) + askedByTruth(100));

function asksByOptionalCall(called, scale) {
  let total = scale > 0 ? asksByOptionalCall(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called?.(scale + i) ?? 2;
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function askedByOptionalCall(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return asksByOptionalCall(bump, 1) + asksByOptionalCall(undefined, 1) + asksByOptionalCall(void 0, 2) + count;
}
say("askedByOptionalCall", askedByOptionalCall(1) + askedByOptionalCall(100));

function asksByUndefined(called, scale) {
  let total = scale > 0 ? asksByUndefined(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called !== undefined ? called(scale + i) : 3;
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function askedByUndefined(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return asksByUndefined(bump, 1) + asksByUndefined(undefined, 1) + asksByUndefined(void 0, 2) + count;
}
say("askedByUndefined", askedByUndefined(1) + askedByUndefined(100));

function asksByIsUndefined(called, scale) {
  let total = scale > 0 ? asksByIsUndefined(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called === undefined ? 3 : called(scale + i);
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function askedByIsUndefined(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return asksByIsUndefined(bump, 1) + asksByIsUndefined(undefined, 1) + asksByIsUndefined(void 0, 2) + count;
}
say("askedByIsUndefined", askedByIsUndefined(1) + askedByIsUndefined(100));

function asksByNull(called, scale) {
  let total = scale > 0 ? asksByNull(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called == null ? 4 : called(scale + i);
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function askedByNull(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return asksByNull(bump, 1) + asksByNull(undefined, 1) + asksByNull(void 0, 2) + count;
}
say("askedByNull", askedByNull(1) + askedByNull(100));

function asksByNotNull(called, scale) {
  let total = scale > 0 ? asksByNotNull(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called != null ? called(scale + i) : 4;
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function askedByNotNull(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return asksByNotNull(bump, 1) + asksByNotNull(undefined, 1) + asksByNotNull(void 0, 2) + count;
}
say("askedByNotNull", askedByNotNull(1) + askedByNotNull(100));

function asksByTypeof(called, scale) {
  let total = scale > 0 ? asksByTypeof(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += typeof called === "function" ? called(scale + i) : 5;
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function askedByTypeof(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return asksByTypeof(bump, 1) + asksByTypeof(undefined, 1) + asksByTypeof(void 0, 2) + count;
}
say("askedByTypeof", askedByTypeof(1) + askedByTypeof(100));

function asksByTypeofUndefined(called, scale) {
  let total = scale > 0 ? asksByTypeofUndefined(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += typeof called === "undefined" ? 6 : called(scale + i);
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function askedByTypeofUndefined(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return (
    asksByTypeofUndefined(bump, 1) + asksByTypeofUndefined(undefined, 1) + asksByTypeofUndefined(void 0, 2) + count
  );
}
say("askedByTypeofUndefined", askedByTypeofUndefined(1) + askedByTypeofUndefined(100));

function asksByAnd(called, scale) {
  let total = scale > 0 ? asksByAnd(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += (called && called(scale + i)) || 7;
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function askedByAnd(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return asksByAnd(bump, 1) + asksByAnd(undefined, 1) + asksByAnd(void 0, 2) + count;
}
say("askedByAnd", askedByAnd(1) + askedByAnd(100));

function asksByNot(called, scale) {
  let total = scale > 0 ? asksByNot(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += !called ? 8 : called(scale + i);
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function askedByNot(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return asksByNot(bump, 1) + asksByNot(undefined, 1) + asksByNot(void 0, 2) + count;
}
say("askedByNot", askedByNot(1) + askedByNot(100));

function asksByCoalescing(called, scale) {
  let total = scale > 0 ? asksByCoalescing(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += (called ?? Math.abs)(scale + i);
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function askedByCoalescing(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return asksByCoalescing(bump, 1) + asksByCoalescing(undefined, 1) + asksByCoalescing(void 0, 2) + count;
}
say("askedByCoalescing", askedByCoalescing(1) + askedByCoalescing(100));

function asksNothing(called, scale) {
  let total = scale > 0 ? asksNothing(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called(scale + i);
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function askedNothing(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return asksNothing(bump, 1) + asksNothing(bump, -5) + count;
}
say("askedNothing", askedNothing(1) + askedNothing(100));

function callsAtTheEnd(called, scale) {
  let total = scale > 0 ? callsAtTheEnd(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called ? called(scale + i) : 1;
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function handsOn(called, scale) {
  let total = scale > 0 ? handsOn(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += callsAtTheEnd(called, scale + i);
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function handsOnTwice(called, scale) {
  let total = scale > 0 ? handsOnTwice(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += handsOn(called, scale + i) + callsAtTheEnd(called, i);
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function handedOn(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return handsOnTwice(bump, 1) + handsOnTwice(undefined, 1) + handsOn(bump, 2) + callsAtTheEnd(undefined, 3) + count;
}
say("handedOn", handedOn(1) + handedOn(100));

function countsArguments(called, scale) {
  let total = scale > 0 ? countsArguments(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += arguments.length + (called ? called(i) : 9);
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function withCountedArguments(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return countsArguments(bump, 1) + countsArguments(undefined, 1) + countsArguments() + count;
}
say("withCountedArguments", withCountedArguments(1) + withCountedArguments(100));

function leftOut(scale, called) {
  let total = scale > 0 ? leftOut(scale - 1, called) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called ? called(scale + i) : 10;
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function withLeftOut(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return leftOut(1, bump) + leftOut(1, undefined) + leftOut(1) + count;
}
say("withLeftOut", withLeftOut(1) + withLeftOut(100));

function hasDefault(scale, called = undefined) {
  let total = scale > 0 ? hasDefault(scale - 1, called) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called ? called(scale + i) : 10;
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function withDefault(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return hasDefault(1, bump) + hasDefault(1, undefined) + hasDefault(1) + count;
}
say("withDefault", withDefault(1) + withDefault(100));

function storesOver(called, scale) {
  let total = scale > 0 ? storesOver(called, scale - 1) : 0;
  for (let i = 0; i < 3; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called ? called(scale + i) : 11;
      if (i === 1) called = undefined;
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function storedOver(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return storesOver(bump, 1) + storesOver(undefined, 1) + count;
}
say("storedOver", storedOver(1) + storedOver(100));

function answersWhetherItCame(called) {
  return [!!called, !called, called === undefined, called !== undefined, called == null, typeof called].join(" ");
}
function answered(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return `${answersWhetherItCame(bump)}, ${answersWhetherItCame(undefined)}, ${answersWhetherItCame()}, ${bump(1)}`;
}
say("answered", answered(1));

// Over one object.
function callsReaderIfGiven(called, scale) {
  let total = scale > 0 ? callsReaderIfGiven(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called ? called(scale + i) : 1;
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function callsReaderUnlessNull(called, scale) {
  let total = scale > 0 ? callsReaderUnlessNull(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called == null ? 2 : called(scale + i);
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function overAnObject(held) {
  const reads = scale => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (scale < 0) throw new RangeError("negative");
        total += held.n * scale + i;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return (
    callsReaderIfGiven(reads, 1) +
    callsReaderIfGiven(undefined, 1) +
    callsReaderUnlessNull(reads, 2) +
    callsReaderUnlessNull(undefined, 2)
  );
}
say("over an object", overAnObject({ n: 3 }) + overAnObject({ n: 50 }));

// Over one value that may itself be taken for nothing.
function callsGiverIfGiven(called, scale) {
  let total = scale > 0 ? callsGiverIfGiven(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called ? called(scale + i) : 1;
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function callsGiverOptionally(called, scale) {
  let total = scale > 0 ? callsGiverOptionally(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called?.(scale + i) ?? 2;
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function callsGiverUnlessNull(called, scale) {
  let total = scale > 0 ? callsGiverUnlessNull(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called == null ? 3 : called(scale + i);
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function overAnyValue(value) {
  const gives = scale => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (scale < 0) throw new RangeError("negative");
        total += (String(value) + scale).length;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return (
    callsGiverIfGiven(gives, 1) +
    callsGiverOptionally(gives, 2) +
    callsGiverUnlessNull(gives, 3) +
    callsGiverIfGiven(undefined, 1) +
    callsGiverOptionally(undefined, 1) +
    callsGiverUnlessNull(undefined, 1)
  );
}
for (const captured of [0, 7, "", "text", undefined, null, false, NaN, 10n, Symbol.iterator.description, {}, []])
  say(`over ${typeof captured} ${String(captured)}`, overAnyValue(captured));

// Captured by another function of the scope, which hands it over.
function callsCapturedIfGiven(called, scale) {
  let total = scale > 0 ? callsCapturedIfGiven(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called ? called(scale + i) : 1;
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function handsOnCaptured(called, scale) {
  let total = scale > 0 ? handsOnCaptured(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += callsCapturedIfGiven(called, scale + i);
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function capturedByAnother(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  const uses = scale => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (scale < 0) throw new RangeError("negative");
        total += handsOnCaptured(bump, scale) + callsCapturedIfGiven(bump, scale) + handsOnCaptured(undefined, i);
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  function entry() {
    return uses(1) + uses(2) + count;
  }
  return entry;
}
say("captured by another", capturedByAnother(1)() + capturedByAnother(5)());

// It or undefined, decided where it is handed over.
function callsChosenIfGiven(called, scale) {
  let total = scale > 0 ? callsChosenIfGiven(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called ? called(scale + i) : 1;
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function chosen(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return callsChosenIfGiven(start > 1 ? bump : undefined, 1) + callsChosenIfGiven(bump, 2) + count;
}
say("chosen", chosen(1) + chosen(100));

// One of those that get it needs the function itself.
const seen = new Set();
function keeps(called, scale) {
  let total = scale > 0 ? keeps(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      if (called) seen.add(called);
      total += called ? called(scale + i) : 1;
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function callsKeptIfGiven(called, scale) {
  let total = scale > 0 ? callsKeptIfGiven(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called ? called(scale + i) : 2;
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function kept(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return (
    keeps(bump, 1) +
    keeps(bump, 2) +
    keeps(undefined, 3) +
    callsKeptIfGiven(bump, 1) +
    callsKeptIfGiven(undefined, 1) +
    count
  );
}
say("kept", kept(1) + kept(100));

say("kept functions", seen.size);
say("kept functions answer", [...seen].map(called => called(1)).join(" "));
function describes(called) {
  return called ? `${called.name} ${called.length} ${typeof called} ${called === called}` : "nothing";
}
function callsDescribedIfGiven(called, scale) {
  let total = scale > 0 ? callsDescribedIfGiven(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called ? called(scale + i) : 3;
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function described(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return (
    `${describes(bump)} ${describes(undefined)} ` +
    callsDescribedIfGiven(bump, 1) +
    callsDescribedIfGiven(undefined, 1) +
    count
  );
}
say("described", described(1) + described(100));

function compares(called, other) {
  return called === other;
}
function callsComparedIfGiven(called, scale) {
  let total = scale > 0 ? callsComparedIfGiven(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called ? called(scale + i) : 4;
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function compared(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return (
    `${compares(bump, bump)} ${compares(bump, undefined)} ${compares(undefined, undefined)} ` +
    callsComparedIfGiven(bump, 1) +
    count
  );
}
say("compared", compared(1) + compared(100));

// Behind an await, and between yields.
function callsAwaitedIfGiven(called, scale) {
  let total = scale > 0 ? callsAwaitedIfGiven(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called ? called(scale + i) : 1;
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function handsOnAwaited(called, scale) {
  let total = scale > 0 ? handsOnAwaited(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += callsAwaitedIfGiven(called, scale + i);
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
async function behindAnAwait(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  const early = callsAwaitedIfGiven(bump, 1);
  await null;
  const late = handsOnAwaited(bump, 1) + handsOnAwaited(undefined, 1);
  await Promise.resolve();
  return `${early} ${late} ${callsAwaitedIfGiven(bump, 2)} ${count}`;
}
say("behind an await", await behindAnAwait(1));
function callsYieldedIfGiven(called, scale) {
  let total = scale > 0 ? callsYieldedIfGiven(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called ? called(scale + i) : 1;
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function* betweenYields(start) {
  let count = start;
  const bump = step => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (step < 0) throw new RangeError("negative");
        count += step;
        total += count;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  yield callsYieldedIfGiven(bump, 1);
  yield callsYieldedIfGiven(undefined, 1);
  yield callsYieldedIfGiven(bump, count);
}
say("between yields", [...betweenYields(1)].join(" "));

// What the function holds is there for as long as a function that can still call it.
function callsHolderIfGiven(called, scale) {
  let total = scale > 0 ? callsHolderIfGiven(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += called ? called(scale + i) : 1;
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function handsOnHolder(called, scale) {
  let total = scale > 0 ? handsOnHolder(called, scale - 1) : 0;
  for (let i = 0; i < 2; i++) {
    try {
      if (scale > 1e6) throw new RangeError("large");
      total += callsHolderIfGiven(called, scale + i);
    } catch (error) {
      total -= error.constructor.name.length;
    }
  }
  return total;
}
function holds(held) {
  const reads = scale => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (scale < 0) throw new RangeError("negative");
        total += held.n + scale;
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  const uses = scale => {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      try {
        if (scale < 0) throw new RangeError("negative");
        total += handsOnHolder(reads, scale) + callsHolderIfGiven(undefined, scale);
      } catch (error) {
        total -= error.message.length;
      }
    }
    return total;
  };
  return uses;
}
const weak = [];
const entries = [];
for (let n = 0; n < 40; n++) {
  const held = { n };
  weak.push(new WeakRef(held));
  entries.push(holds(held));
}
for (let round = 0; round < 6; round++) {
  Bun.gc(true);
  await new Promise(resolve => setTimeout(resolve, 1));
}
say("held", `${weak.filter(w => w.deref() !== undefined).length} of ${weak.length}`);
say(
  "sum",
  entries.reduce((sum, uses) => sum + uses(1), 0),
);

console.log(lines.join("\n"));
