function f104() { return 'ok 104'; }
setTimeout(() => {}, 0); const target = module.exports; (() => { target.f104 = f104; })();
