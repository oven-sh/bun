// Nobody calls the async function, so the compiler has no body for it, and the function that makes its closure makes nothing else.
// variant-verify-each-pass-1.test.ts always takes this program: there the plan of what lies in the frame that is made without the planner is compared with the planner's.
// Flags: --aot-check=verify-each-pass
let kept;
function keeps() {
  kept = async () => 1;
}
keeps();
keeps();
console.log(typeof kept);
