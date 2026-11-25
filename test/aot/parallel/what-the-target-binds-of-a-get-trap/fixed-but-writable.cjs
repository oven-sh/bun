// A member that is fixed and writable binds nothing: the trap may answer what it likes.
Object.defineProperty(exports, "fixed", { value: 1, writable: true });
const watched = new Proxy(exports, { get: () => 7 });
for (let turn = 0; turn < 3; turn++) console.log(watched.fixed, watched["fix" + "ed"]);
