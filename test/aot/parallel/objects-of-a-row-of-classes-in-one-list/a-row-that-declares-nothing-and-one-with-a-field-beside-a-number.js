class Bare {}
class Barer extends Bare {}
class Barest extends Barer {}
class Kept { held = 1; }
class Keeper extends Kept {}
class Keepest extends Keeper {}
const bare = [new Bare(), new Barer(), new Barest(), 5];
const kept = [new Kept(), new Keeper(), new Keepest(), 5];
for (const v of bare) console.log(`SAID ${typeof v === "number" ? v + 1 : "object"}`);
for (const v of kept) console.log(`SAID ${typeof v === "number" ? v + 1 : v.held}`);
