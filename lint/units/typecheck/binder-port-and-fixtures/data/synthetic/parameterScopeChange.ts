function f(
    a = () => x,
    b = { m() { return x; }, get g() { return x; }, set g(v) { }, p: x, [x]: 1 },
    c = class { static s = x; q = x; [x]() { } },
    d = a ?? x,
    e = a?.name,
    { ...r } = b,
    g: typeof x = 1,
    h = function () { return x; },
) {
    var x: any;
}
class K { constructor(p = () => y) { var y: any; } }
