class Base { constructor() { this.name = "base"; } }
class Sub extends Base { get name() { return "sub"; } }
try { const s = new Sub(); console.log("made " + s.name + " " + Object.keys(s).length); } catch (e) { console.log("threw " + e.name); }
class Same { constructor() { this.v = 1; } get v() { return 2; } }
try { const c = new Same(); console.log("made " + c.v + " " + Object.keys(c).length); } catch (e) { console.log("threw " + e.name); }
class Sized { get size() { return 0; } }
class Stores extends Sized { constructor() { super(); this.size = 3; } }
try { const s = new Stores(); console.log("made " + s.size + " " + Object.keys(s).length); } catch (e) { console.log("threw " + e.name); }
class Resets { constructor() { this.reset(); } reset() { this.count = 0; } }
class Counts extends Resets { get count() { return 7; } }
try { const s = new Counts(); console.log("made " + s.count + " " + Object.keys(s).length); } catch (e) { console.log("threw " + e.name); }
class Plain { constructor() { this.v = 1; } }
class Frozen extends Plain {}
Frozen.prototype.v = 9;
Object.freeze(Frozen.prototype);
try { const s = new Frozen(); console.log("made " + s.v + " " + Object.keys(s).length); } catch (e) { console.log("threw " + e.name); }
