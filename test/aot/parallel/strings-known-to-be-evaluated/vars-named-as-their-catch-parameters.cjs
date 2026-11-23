// A var in a catch clause that has the name of the parameter is still a variable of the script: a property of the global object that the initializer leaves undefined.
(0, eval)("try { throw 59; } catch (cob) { var cob = 1; }");
console.log("cob" in globalThis, typeof cob, Object.keys(globalThis).includes("cob"));

(0, eval)("try { throw 7; } catch (dew) { var dew; }");
console.log("dew" in globalThis, typeof dew);

(0, eval)("try { throw 7; } catch (elm) { var elm = elm + 1; } var fig = typeof elm;");
console.log("elm" in globalThis, typeof elm, fig);

(0, eval)("try { throw 3; } catch (ash) { for (var ash = 0; ash < 2; ash++) {} } var bay = 4;");
console.log("ash" in globalThis, typeof ash, bay);

(0, eval)("var gum = 8; try { throw 3; } catch (gum) { var gum = 5; }");
console.log(gum, globalThis.gum);

(0, eval)("let ivy = 9; try { throw 3; } catch (oak) { let pea = oak; }");
console.log(typeof ivy, "oak" in globalThis, "pea" in globalThis);
