// Exit code: 1
function invalid(c: any): this is number { return false; }
declare var c: number | number[];
if (invalid(c)) { c; } else { c; }
