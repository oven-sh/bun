export function h() { return "born"; }
function other() { return "other"; }
export function store() { h = 10n; }
export function readThere() { return h; }
