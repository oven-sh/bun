// Below a `with` the name may be a getter of the scope object, and the read stays.
let log = "";
function run(scope) { let held = 1; with (scope) { held; } return log; }
console.log(run({ get held() { log += "asked "; return 2; } }), run({}));
