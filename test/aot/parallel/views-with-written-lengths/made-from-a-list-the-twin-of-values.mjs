function at4(view) { return view[4]; } function tell(view) { try { return String(at4(view)) + " " + view.length; } catch (error) { return error.constructor.name; } }
const given = JSON.parse('[7, 8]'); console.log(tell(new Int32Array([given[0], 2, 3, 4, given[1], 6])));
