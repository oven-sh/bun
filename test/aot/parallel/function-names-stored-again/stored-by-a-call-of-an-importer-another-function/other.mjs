export function h() { return "born"; }
function other() { return "other"; }
export function store() { h = other; }
export function readThere() { return h; }
