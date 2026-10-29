function f106() { return 'ok 106'; }
setTimeout(() => {}, 0); const target = module.exports; (() => { target.f106 = f106; })();
