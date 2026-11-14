function at4(view) { return view[4]; } function tell(view) { try { return String(at4(view)) + " " + view.length; } catch (error) { return error.constructor.name; } }
console.log(tell(new Int32Array([1, , 3, , 5, , ])), tell(new Float64Array([, , , , , ])));
