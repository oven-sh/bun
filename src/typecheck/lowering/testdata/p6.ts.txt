x = async (a = await 1, b) => { await a; };
x = (a, {b}, [c] = d, ...e) => a;
function g(a = (b) => b) {}
x = async function* h(a) { yield a; };
x = async function () {};
