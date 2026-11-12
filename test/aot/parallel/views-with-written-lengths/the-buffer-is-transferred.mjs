function at4(view) { return view[4]; } function tell(view) { try { return String(at4(view)) + " " + view.length; } catch (error) { return error.constructor.name; } }
const view = new Int32Array(8); view[4] = 7; console.log(tell(view)); view.buffer.transfer(); console.log(tell(view));
