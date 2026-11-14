const require = import.meta.require;
const say = () => {};
const get = load => load.then(() => 1, () => 0);
const tried = deed => { try { deed(); } catch {} };
  say("load", await get(import("./top.mjs")));
