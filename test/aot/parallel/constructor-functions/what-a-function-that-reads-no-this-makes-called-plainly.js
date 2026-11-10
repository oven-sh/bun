// Under: --aot-testing=CheckProofsAtRunTime: what is proven of the object is asked again at run time
// Under: --aot-testing=FailGuesses: every guess fails
function Plain() {}
function call(f) { return f(); }
console.log(call(Plain), typeof new Plain(), process.argv.length > 0);
