// A date below another object finds that object's toJSON. The mark of a pristine cell goes with the change of the prototype.
function stamped(at) { return { at }; }
function text(at) { return JSON.stringify(stamped(at)); }
const plain = new Date(0);
const moved = new Date(5);
for (let turn = 0; turn < 2; ++turn) {
    console.log(text(plain), text(moved));
    Object.setPrototypeOf(moved, { toJSON() { return "moved"; } });
}
