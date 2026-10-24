// A count kept on a static private method starts anew for each evaluation of the class.
for (let i = 0; i < 2; i++) console.log(class C { static #m() {} static count() { return C.#m.calls = (C.#m.calls || 0) + 1; } }.count());
