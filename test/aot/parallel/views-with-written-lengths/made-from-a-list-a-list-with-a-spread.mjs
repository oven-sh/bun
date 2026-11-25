function at4(view) { return view[4]; } function tell(view) { try { return String(at4(view)) + " " + view.length; } catch (error) { return error.constructor.name; } }
const given = JSON.parse('[[], [1, 2, 3, 4, 5, 6]]'); console.log(tell(new Int32Array([1, 2, 3, 4, 5, ...given[0]])), tell(new Int32Array([...given[0], 1])), tell(new Int32Array([...given[1]])));
