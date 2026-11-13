// Hand model of FileReader's handle-mode flags (src/runtime/webcore/FileReader.rs at 9b4d6ad7497).
// State: RC read_callback, F flowing, Q read_start_queued, A arming, W waits_for_next_turn,
// plus what the flags do not hold: QK = which queue the start task is in ('T' this turn, 'Y' after yield),
// kR = JS kReading, and whether a read loop is on the stack.
// Every callback of a read loop is one step; no nested event-loop tick inside a listener.
const seen = new Map(); // flags -> example trace
const visited = new Set();
const key = s => `${s.RC}${s.F}${s.Q}${s.A}${s.W}`;
const full = s => JSON.stringify(s);
const queue = [];
function visit(s, trace) {
  const k = key(s);
  if (!seen.has(k)) seen.set(k, trace);
  const f = full(s);
  if (visited.has(f)) return;
  visited.add(f);
  queue.push([s, trace]);
}
const mixed = [];
// set_flowing(true), FileReader.rs:1165
function setFlowingTrue(s) {
  if (s.F) return s;
  s = { ...s, F: 1 };
  if (s.RC && !s.Q) s = { ...s, Q: 1, QK: "T" }; // queue_read_start(false)
  return s;
}
// JS readStart(), native-readable.ts:230
function jsRead(s) {
  if (s.kR) return s;
  return setFlowingTrue({ ...s, kR: 1 });
}
// wait_for_next_turn(), FileReader.rs:841
function threw(s) {
  if (!s.RC) return s;
  s = { ...s, W: 1 };
  if (!s.Q) s = { ...s, Q: 1, QK: "Y" }; // queue_read_start(true) returns early when Q is set
  return s;
}
// one callback of a running read loop; returns [nextState, loopGoesOn, label]
function* chunkOutcomes(s) {
  // arming (Drained chunk with no poll armed), FileReader.rs:893-901
  visit({ ...s, A: 1 }, "arming");
  // returned true
  yield [s, true, "true"];
  // returned false: F=0, kR=0; then the checkpoint may call _read()
  {
    const stopped = { ...s, F: 0, kR: 0 };
    yield [stopped, false, "false"];
    const again = jsRead(stopped);
    yield [again, true, "false+_read() in the checkpoint"];
  }
  // threw
  yield [threw(s), false, "threw"];
  // destroy() in the listener: on_cancel takes the callback
  yield [{ ...s, RC: 0 }, false, "destroy"];
}
function* loopFrom(s, trace, depth = 0) {
  // the reader delivers only while it is not paused: F && !W
  if (!(s.RC && s.F && !s.W) || depth > 3) {
    yield [s, trace];
    return;
  }
  // the loop may end here: drained, or EOF, or a read error
  yield [s, trace + " | drained"];
  for (const [n, goesOn, label] of chunkOutcomes(s)) {
    const t = trace + " | chunk:" + label;
    visit(n, t);
    if (goesOn) yield* loopFrom(n, t, depth + 1);
    else {
      yield [n, t];
      // EOF or error in the tail of the same loop iteration (final chunk): on_reader_done / on_reader_error
      if (n.RC) {
        // on_reader_done: ends unless W
        if (!n.W) yield [{ ...n, RC: 0 }, t + " | eof"];
        // on_reader_error: ends if F && !W, else held
        if (n.F && !n.W) yield [{ ...n, RC: 0 }, t + " | error"];
      }
    }
  }
  yield [{ ...s, RC: 0 }, trace + " | eof"];
}
// pull mode: both values of `flowing`
visit({ RC: 0, F: 1, Q: 0, QK: null, A: 0, W: 0, kR: 0, everHandle: 0 }, "pull");
visit({ RC: 0, F: 0, Q: 0, QK: null, A: 0, W: 0, kR: 0, everHandle: 0 }, "pull, setFlowing(false)");
// enter_handle_mode
visit({ RC: 1, F: 0, Q: 0, QK: null, A: 0, W: 0, kR: 1, everHandle: 1 }, "enter_handle_mode (transient)");
visit({ RC: 1, F: 1, Q: 1, QK: "T", A: 0, W: 0, kR: 1, everHandle: 1 }, "enter_handle_mode");
while (queue.length) {
  const [s, trace] = queue.shift();
  if (!s.everHandle) continue;
  if (s.A) continue; // transient
  if (s.RC && s.W && s.Q && s.QK === "T") mixed.push(trace);
  // the start task runs: start_reader(), FileReader.rs:852
  if (s.Q) {
    const t = { ...s, Q: 0, QK: null, W: 0 };
    visit(t, trace + " | task");
    if (t.RC && t.F) {
      for (const [n, tr] of loopFrom(t, trace + " | task:loop")) visit(n, tr);
      visit({ ...t, RC: 0 }, trace + " | task:held end or error");
    }
  }
  // the poll fires
  if (s.RC && s.F && !s.W) for (const [n, tr] of loopFrom(s, trace + " | poll:loop")) visit(n, tr);
  // _read() from any other script (a timer, a tick, another stream's listener)
  visit(jsRead(s), trace + " | _read()");
  // destroy() from any other script
  if (s.RC) visit({ ...s, RC: 0 }, trace + " | destroy()");
}
const names = ["read_callback", "flowing", "read_start_queued", "arming", "waits_for_next_turn"];
console.log("reachable combinations of (" + names.join(", ") + "): " + seen.size + " of 32");
for (const [k, trace] of [...seen].sort()) console.log(" ", k, " e.g.", trace);
console.log("states with W=1 and the start task in this turn's queue:", mixed.length ? "reachable, e.g. " + mixed[0] : "none");
