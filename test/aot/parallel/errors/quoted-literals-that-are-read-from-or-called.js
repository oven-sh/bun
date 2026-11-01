// `undefined.x` is printed `(void 0).x` and `true()` `(!0)()`: what is read from or called stands in brackets, and a literal that is called is quoted with its arguments.
const says = f => { try { f(); console.log("nothing thrown"); } catch (error) { console.log(error.message); } };
says(() => undefined[1_000]);
says(() => undefined.x);
says(() => undefined["a-b"]);
says(() => undefined?.x.y.z, 1);
says(() => undefined());
says(() => undefined`t`);
says(() => true.x.y);
says(() => false[0].y);
says(() => true());
says(o => null[undefined]);
says(o => null[true]);
says(o => ({ undefined: 1 }).x.y);
says(o => ({ a: undefined }).a.y);
