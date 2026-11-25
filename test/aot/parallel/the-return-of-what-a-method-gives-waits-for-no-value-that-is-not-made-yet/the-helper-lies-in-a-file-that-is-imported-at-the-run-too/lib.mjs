export var width = 2;
function cut(text, end) { return text.slice(0, end); }
export function head(text) { return cut(text, width + 1); }
