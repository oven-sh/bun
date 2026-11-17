// STATISTIC: ImageFunctionsEmitted <= 20
function Holder() {}
function used() { return "used"; }
function unused() { return process.binding("made up"); }
Object.assign(Holder, { used, unused });
console.log(Holder.used());
