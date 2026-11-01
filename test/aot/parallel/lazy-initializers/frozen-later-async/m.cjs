async function a() {}
a.toString = () => "A!";
a.apply = () => "mine";
a.extra = { x: 1 };
function* g() {}
g.toString = () => "G!";
g.call = 5;
g.extra = { x: 1 };
const arrow = async () => 1;
arrow.toString = () => "arrow!";
arrow.extra = { x: 1 };
arrow.more = { x: 2 };
exports.a = a;
exports.g = g;
exports.arrow = arrow;
