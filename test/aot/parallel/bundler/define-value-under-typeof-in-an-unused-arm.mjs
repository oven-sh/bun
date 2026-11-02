// `typeof` of a name with a `--define` value in an arm of `?:` or behind `&&` is evaluated where nothing uses the result, as `typeof` of what the value names is there: in the dead zone of the `const` it throws a ReferenceError, and the getter at the end of a path runs. The file marks a call as pure, so the build looks for the arms that do nothing. `bun run` leaves such a `typeof` out. Plain Bun prints another output.
// Flags: --define NAME=target --define ROOT=holder.value
const holder = {
  get value() {
    console.log("the getter ran");
    return 1;
  },
};
const yes = () => true;
const made = /* @__PURE__ */ yes();
function attempt(action) {
  try {
    action();
    return "no throw";
  } catch (error) {
    return error.constructor.name;
  }
}
console.log(
  attempt(() => {
    yes() ? typeof NAME : 0;
  }),
  attempt(() => {
    yes() && typeof NAME;
  }),
);
yes() ? typeof ROOT : 0;
yes() && typeof ROOT;
const target = 1;
console.log("end", made);
/* Output:
ReferenceError ReferenceError
the getter ran
the getter ran
end true
*/
