// Own value 0 of what is made (caught error) comes out by from entries.
function caught(deed) { try { deed(); } catch (error) { return error; } }
function use(e) { return typeof e; }
const m = caught(() => null.x);
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }
