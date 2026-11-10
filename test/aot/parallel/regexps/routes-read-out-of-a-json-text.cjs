// STATISTIC: RegExpCandidatesCompiled = 8
const written = JSON.parse('["/users/:id","/users/:id/posts/:post","/files/:name","/health","/shops/:shop/orders/:order"]');
const routes = written.map(text => {
    const names = [];
    return { names, pattern: new RegExp("^" + text.replace(/:(\w+)/g, (_, name) => { names.push(name); return "([^/]+)"; }) + "$") };
});
function find(path) {
    for (const route of routes) {
        const found = route.pattern.exec(path);
        if (!found)
            continue;
        const held = {};
        for (let at = 0; at < route.names.length; at++)
            held[route.names[at]] = found[at + 1];
        return held;
    }
    return null;
}
for (const path of ["/users/7", "/users/7/posts/9", "/files/a.txt", "/health", "/shops/3/orders/12", "/nowhere", "/users/"])
    console.log(path, JSON.stringify(find(path)));
const table = JSON.parse('{"digits":"[0-9]+","word":{"of":["[a-z]+","[A-Z]+"]}}', (key, value) => (typeof value === "string" ? "^" + value + "$" : value));
console.log(new RegExp(table.digits).test("2026"), new RegExp(table.word.of[0]).test("bun"), new RegExp(table.word.of[1]).test("bun"));
