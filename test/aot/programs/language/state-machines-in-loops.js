const lines = [];
function log(...parts) { lines.push(parts.map(String).join(" ")); }

function constantStates(n) {
  let state = 1, i = 0, sum = 0, trace = "";
  for (;;) {
    switch (state) {
      case 1: i = 0; trace += "a"; state = 2; break;
      case 2: if (i >= n) { state = 4; break; } sum += i; state = 3; break;
      case 3: i++; trace += i & 1 ? "b" : "c"; state = 2; break;
      case 4: return sum + ":" + trace;
    }
  }
}

function unknownNextState(table, limit) {
  let state = 0, steps = 0, trace = "";
  for (;;) {
    switch (state) {
      case 0: trace += "0"; break;
      case 1: trace += "1"; break;
      case 2: trace += "2"; break;
      default: return trace + "!" + state;
    }
    if (++steps > limit) return trace;
    state = table[state];
  }
}

function guardedEntry(a, b, table, limit) {
  let trace = "none";
  if (a && b) {
    let state = 1, carried = 0;
    trace = "";
    for (;;) {
      switch (state) {
        case 1: carried += 1; trace += "x"; break;
        case 2: carried += 10; trace += "y"; break;
        default: return trace + carried;
      }
      if (carried > limit) return trace + ":" + carried;
      state = table[state];
    }
  }
  return trace;
}

function guardedEntryWithConstantStates(a, b, n) {
  let trace = "none";
  if (a && b) {
    let state = 1, i = 0;
    trace = "";
    for (;;) {
      switch (state) {
        case 1: trace += "s"; state = 2; break;
        case 2: if (i++ < n) { trace += i; state = 2; } else state = 3; break;
        default: return trace;
      }
    }
  }
  return trace;
}

function twoWaysIn(flag, n) {
  let state = flag ? 1 : 2, i = 0, trace = "";
  for (;;) {
    switch (state) {
      case 1: trace += "p"; state = 2; break;
      case 2: trace += "q"; if (++i >= n) return trace; state = 1; break;
    }
  }
}

function entersCycleAtTwoStates(flag, n) {
  let state = 1, i = 0, trace = "";
  for (;;) {
    switch (state) {
      case 1: state = flag ? 2 : 3; break;
      case 2: trace += "l"; if (++i >= n) return trace; state = 3; break;
      case 3: trace += "r"; if (++i >= n) return trace; state = 2; break;
    }
  }
}

function nested(n) {
  let outer = 1, total = 0, round = 0;
  for (;;) {
    switch (outer) {
      case 1: {
        let inner = 1, k = 0;
        scan: for (;;) {
          switch (inner) {
            case 1: k += round; inner = 2; break;
            case 2: total += k; inner = k > 3 ? 3 : 1; if (!round) inner = 3; break;
            case 3: break scan;
          }
        }
        outer = 2;
        break;
      }
      case 2: if (++round >= n) return total; outer = 1; break;
    }
  }
}

function stateIsReadInACase(n) {
  let state = 1, sum = 0;
  for (;;) {
    switch (state) {
      case 1: case 2: case 3: sum += state * 10; state = state + 1; break;
      case 4: if (--n <= 0) return sum; state = 1; break;
    }
  }
}

function leavesThroughFinally(n) {
  const trace = [];
  for (let i = 0; i < n; i++) {
    try {
      if (i === 1) continue;
      if (i === 3) break;
      if (i === 5) return "never";
      trace.push("body" + i);
    } finally {
      trace.push("finally" + i);
    }
    trace.push("after" + i);
  }
  return trace.join(",");
}

function returnsThroughFinally(kind) {
  let trace = "";
  try {
    if (kind === 0) return trace + "zero";
    if (kind === 1) throw new Error("one");
    trace += "fell";
  } catch (error) {
    trace += error.message;
    if (kind === 1) return trace + "!";
  } finally {
    trace += "|cleanup";
    if (kind === 2) return trace;
  }
  return trace + "|end";
}

function errorChoosesTheState(values) {
  let state = 1, index = 0, trace = "";
  for (;;) {
    try {
      switch (state) {
        case 1: if (index >= values.length) return trace; state = 2; break;
        case 2: trace += values[index++].name.length; state = 1; break;
        case 3: trace += "?"; state = 1; break;
      }
    } catch (error) {
      state = 3;
    }
  }
}

function stringStates(n) {
  let state = "start", i = 0, trace = "";
  for (;;) {
    switch (state) {
      case "start": trace += "<"; state = "item"; break;
      case "item": if (i++ >= n) { state = "end"; break; } trace += i; state = "item"; break;
      case "end": return trace + ">";
    }
  }
}

const cycle = [1, 2, 0];
const leaves = [2, 7, 1];
for (let round = 0; round < 300; round++) {
  const all = [
    constantStates(0), constantStates(1), constantStates(5),
    unknownNextState(cycle, 7), unknownNextState(leaves, 7), unknownNextState([0], 2),
    guardedEntry(true, 1, [0, 2, 1], 25), guardedEntry(true, 0, cycle, 25), guardedEntry(false, 1, cycle, 25), guardedEntry("a", {}, [0, 2, 9], 100),
    guardedEntryWithConstantStates(1, 1, 3), guardedEntryWithConstantStates(1, null, 3), guardedEntryWithConstantStates(0, 1, 3),
    twoWaysIn(true, 3), twoWaysIn(false, 3), twoWaysIn(false, 1),
    entersCycleAtTwoStates(true, 4), entersCycleAtTwoStates(false, 4), entersCycleAtTwoStates(false, 1),
    nested(1), nested(4), stateIsReadInACase(2),
    leavesThroughFinally(3), leavesThroughFinally(8), returnsThroughFinally(0), returnsThroughFinally(1), returnsThroughFinally(2), returnsThroughFinally(3),
    errorChoosesTheState([{ name: "ab" }, {}, null, { name: "c" }]), stringStates(0), stringStates(3),
  ];
  if (round === 0 || round === 299) all.forEach((text, index) => log(round, index, text));
}
console.log(lines.join("\n"));
