export function h() { return "born"; }
function other() { return "other"; }
export function store() { h = undefined; }
export function readThere() { return h; }
