// A class that is read in its own computed member name is in its dead zone.
(function () { try { class C { [C]() {} } console.log(Object.getOwnPropertyNames(C.prototype).join()); } catch (e) { console.log(e.name); } })();
