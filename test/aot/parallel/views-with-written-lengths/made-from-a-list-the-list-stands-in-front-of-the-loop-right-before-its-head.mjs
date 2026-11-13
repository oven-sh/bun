function at4(view) { return view[4]; } function tell(view) { try { return String(at4(view)) + " " + view.length; } catch (error) { return error.constructor.name; } }
function run(times) { const list = [1, 2, 3, 4, 5, 6]; do { console.log(tell(new Int32Array(list))); list.pop(); list.pop(); } while (--times > 0); } run(3);
