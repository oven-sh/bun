// new.target outside of every function that is not an arrow function. The arrow function is an argument, because bun run drops an unused one before JavaScriptCore reads it.
new.target;
f(() => new.target);
({ a: new.target });
class C { [new.target]() {} }
