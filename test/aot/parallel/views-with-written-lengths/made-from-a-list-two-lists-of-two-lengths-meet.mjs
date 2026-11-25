function at4(view) { return view[4]; } function tell(view) { try { return String(at4(view)) + " " + view.length; } catch (error) { return error.constructor.name; } }
const given = JSON.parse('{"short":true}'); const view = given.short ? new Int32Array([1, 2]) : new Int32Array([1, 2, 3, 4, 5, 6]); console.log(tell(view), tell(new Int32Array([1, 2, 3, 4, 5, 6])));
