function at4(view) { return view[4]; } function tell(view) { try { return String(at4(view)) + " " + view.length; } catch (error) { return error.constructor.name; } }
const given = JSON.parse('{"short":true}'); const view = given.short ? new Int32Array(2) : new Int32Array(8); console.log(tell(view)); console.log(tell(new Int32Array(8)));
