function log(method: any, context: any) { return function (this: any, ...rest: any[]) { return "logged " + method.apply(this, rest); }; }
const names: string[] = [];
function note(_: any, context: any) { names.push(String(context.name)); }
class Service { @log run() { return "ran"; } @note idle() { return "idle"; } }
console.log(new Service().run(), names.join(), (new Service() as any)[names[0]]());
