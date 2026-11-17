function Base() { this.id = 1; }
const half = JSON.parse('1.5');
Base.prototype[half] = function () { return 'above' + this.id; };
function Heir() { Base.call(this); this.id = 2; }
Heir.prototype = Object.create(Base.prototype);
class Top { constructor() { this.id = 3; } }
Top.prototype[half] = function () { return 'top' + this.id; };
class Low extends Top { constructor() { super(); this.id = 4; } }
const own = new Low(); own[half] = function () { return 'own' + this.id; };
console.log([new Base(), new Heir(), new Top(), new Low(), own].map((one) => one['1.5']()).join());
