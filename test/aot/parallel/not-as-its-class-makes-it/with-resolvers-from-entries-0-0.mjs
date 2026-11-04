// Own value 0 of what is made (with resolvers) comes out by from entries.
function use(e) { return typeof e; }
const m = Promise.withResolvers();
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }
