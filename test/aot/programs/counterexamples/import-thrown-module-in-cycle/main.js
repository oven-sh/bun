// `import()` of a module that threw its own error rejects with that error, though another module of its cycle had thrown before.
const show = e => (e instanceof Error ? e.message : String(e));
const quiet = () => { let p = Promise.resolve(); for (let i = 0; i < 50; i++) p = p.then(() => {}); return p; };
const seen = (what, p) => p.then(() => console.log(what + " resolves"), e => console.log(what + " rejects " + show(e))).then(quiet);
seen("first", import("./first.js")).then(() => seen("early", import("./early.js"))).then(() => seen("late", import("./late.js"))).then(() => seen("first again", import("./first.js")));
