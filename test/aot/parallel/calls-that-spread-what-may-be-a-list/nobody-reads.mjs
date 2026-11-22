const lists = JSON.parse('[[1,2],"cd",[3],[4,5,6]]');
const log = [], sink = JSON.parse('{"rows":[]}');
const o = { put(a, b) { log.push(a + "/" + b); } };
function put(a, b) { log.push(a + ":" + b); }
function inner(xs) { put(...xs); }
function plainCalls(ls) { for (let i = 0; i < ls.length; i++) put(...ls[i]); }
function methods(ls, t) { for (let i = 0; i < ls.length; i++) { t.put(...ls[i]); sink.rows.push(...ls[i]); } }
function copied(ls) { for (let i = 0; i < ls.length; i++) inner(ls[i]); }
function twice(ls) { for (let i = 0; i < ls.length; i++) { put(...ls[i]); put(...ls[ls.length - 1 - i]); } }
function tried(ls) { for (let i = 0; i < ls.length; i++) { try { put(...ls[i]); null.x; } catch { log.push("c" + ls[i].length); } } }
async function waited(ls) { for (let i = 0; i < ls.length; i++) { put(...ls[i]); await 0; } }
plainCalls(lists); methods(lists, o); copied(lists); twice(lists); tried(lists); await waited(lists);
console.log(`SAID ${log.join(" ")} | ${sink.rows.join("")}`);
