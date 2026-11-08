const seen = [];
const note = (value) => { seen.push(value); return () => {}; };
const attempt = (run) => { try { return run(); } catch (error) { return error.name; } };
let poke;
const member = () => { seen.push("member " + poke()); };
const look = (made) => { seen.push("class " + poke()); return class extends made {}; };

@look class Kit {
  static [(poke = () => attempt(() => { Kit = 5; return "stored"; }), "key")] = 1;
  @note(poke()) first = 1;
  @note(attempt(() => (Kit ||= 5))) second = 1;
  @note(attempt(() => (Kit &&= 5))) third = 1;
  @note(attempt(() => (Kit ??= 5))) fourth = 1;
  @note(attempt(() => Kit++)) fifth = 1;
  @note(attempt(() => ([Kit] = [5]))) sixth = 1;
  @member method() {}
  static later() { return [poke(), attempt(() => typeof (Kit ||= 5)), attempt(() => (Kit &&= 5)), attempt(() => typeof (Kit ??= 5)), attempt(() => Kit++)].join(); }
}
console.log(seen.join());
console.log(Kit.later(), typeof Kit);
try {
  @look class Box {
    static [(Box = 5, "key")] = 2;
  }
} catch (error) {
  console.log(error.name + ": " + error.message);
}
