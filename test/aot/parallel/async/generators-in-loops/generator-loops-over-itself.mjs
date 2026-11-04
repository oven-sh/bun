// the body of a generator loops over the generator that is running it
let self;
function* eats() { let turns = 0; try { for (const value of self) turns += value; } catch (error) { console.log(error.name + " behind " + turns + " turns"); yield "caught"; } yield "on"; }
function deed() { self = eats(); return String(self.next().value) + " " + String(self.next().value) + " " + String(self.next().done); }
console.log(deed());
for (let i = 0; i < 3; i++) console.log(deed());
