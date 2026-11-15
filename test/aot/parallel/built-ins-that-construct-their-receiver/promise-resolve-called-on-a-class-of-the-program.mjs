class Later extends Promise {}
const kept = [];
function Capability(executor) { executor(value => kept.push(["kept", value]), reason => kept.push(["refused", reason])); this.mark = "made"; }
console.log(Promise.resolve.call(Later, 1) instanceof Later, await Promise.all.call(Later, [1, 2]), Promise.resolve.call(Capability, 5).mark, kept.join());
console.log(Promise.reject.call(Capability, 6).mark, kept.join(), Promise.withResolvers.call(Capability).promise.mark);
try { Promise.resolve.call(EventTarget, 1); console.log("made"); } catch (error) { console.log(error.name); }
