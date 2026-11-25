const hidden = value => { try { throw value; } catch (caught) { return caught; } };
function look(step) { return typeof step; }
function run(step) { return step(); }
const one = () => 1, two = () => 2, three = () => 3, four = () => 4;
console.log(run(one), run(two), look(three), look(four));
console.log(hidden(three)(), hidden({ kept: four }).kept());
