try { new Function("class C { accessor a = 1 }; return new C().a")(); console.log("JSC parses accessor"); } catch (e) { console.log("JSC rejects accessor:", e.message); }
try { new Function("try {} catch (e = 1) {}")(); console.log("JSC parses catch initializer"); } catch (e) { console.log("JSC rejects catch initializer:", e.message); }
