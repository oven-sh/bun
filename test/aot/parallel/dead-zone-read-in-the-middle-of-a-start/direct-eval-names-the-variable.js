function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
try { seen = eval("late.rate"); } catch (error) { seen = error.name; }
const late = { rate: 0.2 };
console.log(seen, read());
