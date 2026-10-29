function f103() { return 'ok 103'; }
setTimeout(() => {}, 0); const target = module.exports; (() => { target.f103 = f103; })();
