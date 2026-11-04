const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(URLSearchParams.prototype));
try { console.log(copy); } catch (error) { console.log(error.name, error.message); }
console.log("after");
