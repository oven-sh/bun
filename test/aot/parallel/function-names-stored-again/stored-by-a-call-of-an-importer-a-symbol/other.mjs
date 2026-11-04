export function h() { return "born"; }
function other() { return "other"; }
export function store() { h = Symbol("s"); }
export function readThere() { return h; }
