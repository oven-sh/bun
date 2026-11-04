export function h() { return "born"; }
function other() { return "other"; }
export function store() { h = { a: 1 }; }
export function readThere() { return h; }
