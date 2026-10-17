// A class whose static block threw stays in its dead zone.
let get = (): unknown => 0;
try { get = () => B; class B { static { throw 0; } } } catch { console.log("caught"); }
try { console.log(typeof get()); } catch (e) { console.log((e as Error).name); }
