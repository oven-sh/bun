function show(name, f) { try { console.log(name, f()); } catch (error) { console.log(name, error.name); } }
show("function over var", function () { var e = 1; try { throw 5; } catch (e) { eval("function e() { return 1; }"); } return typeof e; });
show("block function over var", function () { var e = 1; try { throw 5; } catch (e) { eval("if (true) { function e() { return 1; } }"); } return typeof e; });
show("function over parameter", function (e) { try { throw 5; } catch (e) { eval("function e() { return 1; }"); } return typeof e; });
show("nested catch", function () { var e = 1; try { throw 5; } catch (e) { try { throw 6; } catch (e) { eval("function e() { return 1; }"); } } return typeof e; });
show("function, no var", function () { try { throw 5; } catch (e) { eval("function e() { return 1; }"); } return typeof e; });
show("var over var", function () { var e = 1; try { throw 5; } catch (e) { eval("var e = 7;"); } return e; });
