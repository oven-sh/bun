// A `const` at the top of a module that nothing reads takes a call that is marked pure, of a name with a `--define` value. The call runs where the first name of the value is a `const` of the file, and is left out where it is a global, as a marked call of the global written there is. Plain Bun runs all four calls. Plain Bun prints another output.
// Flags: --define BOUND=made --define FREE=shared --define BROOT=holder.make --define FROOT=sharedHolder.make
const made = () => console.log("the function of the file ran");
globalThis.shared = () => console.log("the global ran");
const holder = { make: () => console.log("the member of the const ran") };
globalThis.sharedHolder = { make: () => console.log("the member of the global ran") };
const a = /* @__PURE__ */ BOUND();
const b = /* @__PURE__ */ FREE();
const c = /* @__PURE__ */ BROOT();
const d = /* @__PURE__ */ FROOT();
console.log("end");
/* Output:
the function of the file ran
the member of the const ran
end
*/
