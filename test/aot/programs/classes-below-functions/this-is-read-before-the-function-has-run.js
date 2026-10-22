function Meter() { this.made = 1; }
class Fine extends Meter { constructor(early) { if (early) { try { this.extra = 1; } catch (error) { console.log(error.constructor.name); } } super(); this.extra = 2; } }
console.log(JSON.stringify(new Fine(true)), JSON.stringify(new Fine(false)));
class Never extends Meter { constructor() { } }
try { new Never(); } catch (error) { console.log(error.constructor.name); }
class Twice extends Meter { constructor() { super(); try { super(); } catch (error) { console.log(error.constructor.name, JSON.stringify(this)); } } }
new Twice();
