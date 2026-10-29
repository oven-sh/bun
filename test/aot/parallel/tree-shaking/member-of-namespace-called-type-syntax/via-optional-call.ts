export function start(this: any) { return "optional call, " + this.other(); }
export function other() { return "other"; }
