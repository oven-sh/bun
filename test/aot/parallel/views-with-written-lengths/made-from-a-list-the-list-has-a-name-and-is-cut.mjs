function at4(view) { return view[4]; } function tell(view) { try { return String(at4(view)) + " " + view.length; } catch (error) { return error.constructor.name; } }
const list = [1, 2, 3, 4, 5, 6]; list.length = 2; console.log(tell(new Int32Array(list)));
