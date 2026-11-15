class Ash { /** @type {"a"} */ tag = "a"; ashes() { return 1; } }
class Birch extends Ash { bark() { return 2; } }
class Cedar extends Birch { cones() { return 3; } }
class Oak { /** @type {"o"} */ tag = "o"; acorns() { return 4; } }
class Olive extends Oak { oil() { return 5; } }
const list = [new Ash(), new Birch(), new Cedar(), new Oak(), new Olive()];
for (const x of list) console.log(`SAID ${x.tag === "o" ? x.acorns() : x.ashes()} ${x instanceof Cedar ? x.cones() : "-"}`);
const beside = [new Cedar(), { tag: "z", cones() { return 9; } }, new Olive()];
for (const x of beside) console.log(`SAID ${x.tag}`);
