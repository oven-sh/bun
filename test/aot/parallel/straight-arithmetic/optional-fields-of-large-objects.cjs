// STATISTIC: LargeObjectFieldsChecked >= 8
// A function that a loop calls reads many fields of one record, and some are filled late or never: each read looks into the cell.
function States() {
  let states = new WeakMap(), asked = 0;
  const marks = [null, undefined];
  function has(owner) { return states.has(owner); }
  function get(owner) {
    for (let i = 0; i < marks.length; i++) if (marks[i] === owner) asked++;
    let state = states.get(owner);
    if (state === undefined) {
      state = {};
      states.set(owner, state);
    }
    return state;
  }
  function replace(owner, state) { states.set(owner, state); }
  return { has: has, get: get, replace: replace };
}
const held = States();
function fill(owner, n) {
  const state = held.get(owner);
  state.version = owner.version;
  state.lights = n % 3 === 0;
  state.fog = n % 4 === 1 ? owner : null;
  state.skinning = n % 5 === 2;
  if (n % 2) { state.alpha = true; state.beta = n; }
  if (n % 7 === 3) state.gamma = "gamma" + n;
  state.program = { id: n };
  state.delta = n % 8 === 6 ? n : undefined;
  if (n > 12) state.epsilon = n;
  if (n % 6 === 5) state.omega = undefined;
}
function needsChange(owner, fog) {
  const state = held.get(owner);
  const version = state.version, lights = state.lights, skinning = state.skinning, alpha = state.alpha, beta = state.beta, gamma = state.gamma;
  const delta = state.delta, epsilon = state.epsilon, omega = state.omega, program = state.program, bones = state.bones;
  if (version !== owner.version) return "version";
  if (lights === true && epsilon !== undefined) return "lights " + epsilon;
  if (state.fog !== null && state.fog !== fog) return "fog";
  if (skinning === true && bones === undefined) return "skinning";
  if (alpha && beta > 4) return "alpha " + beta;
  if (gamma !== undefined) return "gamma " + gamma;
  if (omega !== undefined || "omega" in state) return "omega " + omega;
  if (delta !== undefined && epsilon !== delta) return "delta " + delta;
  return program === undefined ? "none" : "kept " + program.id + " " + epsilon;
}
globalThis.KEPT = [fill, needsChange];
const owners = [];
for (let i = 0; i < 24; i++) owners.push({ version: i % 3, name: "owner" + i });
function pass(all, fog) {
  const out = [];
  for (let i = 0; i < all.length; i++) {
    const owner = all[i], answer = needsChange(owner, fog);
    out.push(answer);
    if (answer === "version") fill(owner, owners.indexOf(owner));
  }
  return out.join(", ");
}
const lines = [];
for (let turn = 0; turn < 4; turn++) lines.push(pass(owners, turn % 2 ? owners[1] : null));
globalThis.odd = which => {
  switch (which) {
  case 8: return Object.freeze(JSON.parse('{"version":2,"fog":null}'));
  case 9: return new Proxy({ version: 0, fog: null }, { get(t, k) { lines.push("get " + String(k)); return t[k]; }, has(t, k) { lines.push("has " + String(k)); return k in t; } });
  case 10: return [1, 2];
  }
  return Object.assign(() => 1, { version: 2, alpha: 1, beta: 9n });
};
for (let i = 8; i < 12; i++) held.replace(owners[i], globalThis.odd(i));
for (let turn = 0; turn < 3; turn++) lines.push(pass(owners, null));
console.log(lines.join("\n"));
