// for (async of is not allowed in an await context either.
async function f() { for (async of []) {} }
async function* g() { for (async of []) {} }
const f = async () => { for (async of []) {} };
class C { async m() { for (async of []) {} } }
function f() { for (async of []) {} }
