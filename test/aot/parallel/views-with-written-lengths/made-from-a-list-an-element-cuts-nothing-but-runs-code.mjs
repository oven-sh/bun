function at4(view) { return view[4]; } function tell(view) { try { return String(at4(view)) + " " + view.length; } catch (error) { return error.constructor.name; } }
let seen = 0; const thief = { valueOf() { seen++; return 9; } }; console.log(tell(new Int32Array([1, 2, 3, 4, thief, 6])), seen);
