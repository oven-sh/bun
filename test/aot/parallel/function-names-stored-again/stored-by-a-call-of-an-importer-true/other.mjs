export function h() { return "born"; }
function other() { return "other"; }
export function store() { h = true; }
export function readThere() { return h; }
