// the name that a class has inside itself is a constant: not initialized while the parent and the keys are computed
function attempt(run) { try { return "answered " + String(run()); } catch (error) { return error.constructor.name; } }
function inParent() { let seen; class Late extends (seen = attempt(() => eval("Late = 2")), Object) {} return seen + " | " + typeof Late; }
function inKey() { let seen; class Late { [(seen = attempt(() => eval("Late = 2")), "key")]() {} } return seen + " | " + typeof Late; }
function inKeyOfExpression() { let seen; const made = class Late { [(seen = attempt(() => eval("Late = 2")), "key")]() {} }; return seen + " | " + typeof made; }
function inMethod() { class Late { static probe() { return attempt(() => eval("Late = 2")); } } return Late.probe() + " | " + typeof Late; }
function inStaticField() { class Late { static seen = attempt(() => eval("Late = 2")); } return Late.seen + " | " + typeof Late; }
function inMethodOfExpression() { const made = class Late { static probe() { return attempt(() => eval("Late = 2")); } }; return made.probe() + " | " + typeof made; }
for (const probe of [inParent, inKey, inKeyOfExpression, inMethod, inStaticField, inMethodOfExpression]) console.log(probe.name + ": " + probe());
