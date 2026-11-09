// A store to onmessage, or under a key made at run time, hands the global object to native code. What native code keeps for itself does not come out with it.
// STATISTIC: ImageFunctionsEmitted <= 100 Todo: what this program reaches of Bun's library is not cut down to what it uses yet
globalThis.onmessage = event => console.log("message", typeof event);
for (const name of ["first", "second"]) globalThis["my" + name] = name.length;
console.log(typeof onmessage, globalThis.myfirst, globalThis.mysecond);
globalThis.onmessage = null;
