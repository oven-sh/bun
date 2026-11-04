class Base { constructor(size) { this.size = size; } }
class Given extends Base { twice = this.size * 2; #hidden = this.twice + 1; hidden() { return this.#hidden; } }
class Below extends Given { thrice = this.twice + this.size; }
let sum = 0;
for (let i = 0; i < 100; i++) { const made = new Below(i); sum += made.thrice + made.hidden(); }
console.log(sum);
